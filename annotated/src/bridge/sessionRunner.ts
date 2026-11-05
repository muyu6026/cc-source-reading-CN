import { type ChildProcess, spawn } from 'child_process'
import { createWriteStream, type WriteStream } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { createInterface } from 'readline'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import { debugTruncate } from './debugUtils.js'
import type {
  SessionActivity,
  SessionDoneStatus,
  SessionHandle,
  SessionSpawner,
  SessionSpawnOpts,
} from './types.js'

// 活动环形缓冲保留十条，够界面显示最近几步又不会撑大内存
const MAX_ACTIVITIES = 10
// 标准错误只留最后十行，用于失败诊断
const MAX_STDERR_LINES = 10

/**
 * Sanitize a session ID for use in file names.
 * Strips any characters that could cause path traversal (e.g. `../`, `/`)
 * or other filesystem issues, replacing them with underscores.
 */
// 会话标识要拼进文件名，先把非白名单字符统一替换掉，挡住路径穿越
export function safeFilenameId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * A control_request emitted by the child CLI when it needs permission to
 * execute a **specific** tool invocation (not a general capability check).
 * The bridge forwards this to the server so the user can approve/deny.
 */
// 真正需要转给用户的只有一种控制请求：某次具体的工具调用要不要放行；其余控制消息子进程自己处理
export type PermissionRequest = {
  type: 'control_request'
  request_id: string
  request: {
    /** Per-invocation permission check — "may I run this tool with these inputs?" */
    subtype: 'can_use_tool'
    tool_name: string
    input: Record<string, unknown>
    tool_use_id: string
  }
}

// 生成器依赖：可执行文件、前置参数、环境变量、几个开关与三个回调
type SessionSpawnerDeps = {
  execPath: string
// 前置参数这一项是给包管理器安装方式留的：那时可执行文件是 node 运行时，脚本路径必须排在所有参数之前，否则 node 会把桥接参数当成自己的选项直接退出
  /**
   * Arguments that must precede the CLI flags when spawning. Empty for
   * compiled binaries (where execPath is the claude binary itself); contains
   * the script path (process.argv[1]) for npm installs where execPath is the
   * node runtime. Without this, node sees --sdk-url as a node option and
   * exits with "bad option: --sdk-url" (see anthropics/claude-code#28334).
   */
  scriptArgs: string[]
  env: NodeJS.ProcessEnv
  verbose: boolean
  sandbox: boolean
  debugFile?: string
  permissionMode?: string
  onDebug: (msg: string) => void
  onActivity?: (sessionId: string, activity: SessionActivity) => void
  onPermissionRequest?: (
    sessionId: string,
    request: PermissionRequest,
    accessToken: string,
  ) => void
}

/** Map tool names to human-readable verbs for the status display. */
// 工具名到动词的映射：状态行显示正在读还是正在跑，比显示工具名直观
const TOOL_VERBS: Record<string, string> = {
  Read: 'Reading',
  Write: 'Writing',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Bash: 'Running',
  Glob: 'Searching',
  Grep: 'Searching',
  WebFetch: 'Fetching',
  WebSearch: 'Searching',
  Task: 'Running task',
  FileReadTool: 'Reading',
  FileWriteTool: 'Writing',
  FileEditTool: 'Editing',
  GlobTool: 'Searching',
  GrepTool: 'Searching',
  BashTool: 'Running',
  NotebookEditTool: 'Editing notebook',
  LSP: 'LSP',
}

// 摘要只取一个关键字段：文件路径优先，其次模式、命令、地址、查询
function toolSummary(name: string, input: Record<string, unknown>): string {
  const verb = TOOL_VERBS[name] ?? name
// 这条级联的顺序就是重要性排序，命令还会被截到六十字符
  const target =
    (input.file_path as string) ??
    (input.filePath as string) ??
    (input.pattern as string) ??
    (input.command as string | undefined)?.slice(0, 60) ??
    (input.url as string) ??
    (input.query as string) ??
    ''
  if (target) {
    return `${verb} ${target}`
  }
  return verb
}

// 从一行流式消息里抽出可显示的活动；解析失败返回空数组而不是抛错
function extractActivities(
  line: string,
  sessionId: string,
  onDebug: (msg: string) => void,
): SessionActivity[] {
  let parsed: unknown
  try {
// 子进程可能输出非 JSON 的行（比如崩溃时的堆栈），这类行直接跳过
    parsed = jsonParse(line)
  } catch {
    return []
  }

  if (!parsed || typeof parsed !== 'object') {
    return []
  }

  const msg = parsed as Record<string, unknown>
  const activities: SessionActivity[] = []
  const now = Date.now()

// 只认两种消息：助手的消息块与最终结果，其余类型一律忽略
  switch (msg.type) {
    case 'assistant': {
      const message = msg.message as Record<string, unknown> | undefined
      if (!message) break
      const content = message.content
      if (!Array.isArray(content)) break

      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>

// 工具调用变成一条活动，摘要由名字与输入生成
        if (b.type === 'tool_use') {
          const name = (b.name as string) ?? 'Tool'
          const input = (b.input as Record<string, unknown>) ?? {}
          const summary = toolSummary(name, input)
          activities.push({
            type: 'tool_start',
            summary,
            timestamp: now,
          })
          onDebug(
            `[bridge:activity] sessionId=${sessionId} tool_use name=${name} ${inputPreview(input)}`,
          )
// 文本块的摘要截八十字符，只够做一行提示
        } else if (b.type === 'text') {
          const text = (b.text as string) ?? ''
          if (text.length > 0) {
            activities.push({
              type: 'text',
              summary: text.slice(0, 80),
              timestamp: now,
            })
            onDebug(
              `[bridge:activity] sessionId=${sessionId} text "${text.slice(0, 100)}"`,
            )
          }
        }
      }
      break
    }
// 结果消息按子类型分：成功给一句完成，失败优先用服务端给的第一条错误
    case 'result': {
      const subtype = msg.subtype as string | undefined
// 成功分支不带错误信息
      if (subtype === 'success') {
        activities.push({
          type: 'result',
          summary: 'Session completed',
          timestamp: now,
        })
        onDebug(
          `[bridge:activity] sessionId=${sessionId} result subtype=success`,
        )
// 有子类型但非成功就算失败，子类型本身也能当兜底文案
      } else if (subtype) {
        const errors = msg.errors as string[] | undefined
        const errorSummary = errors?.[0] ?? `Error: ${subtype}`
        activities.push({
          type: 'error',
          summary: errorSummary,
          timestamp: now,
        })
        onDebug(
          `[bridge:activity] sessionId=${sessionId} result subtype=${subtype} error="${errorSummary}"`,
        )
// 既没成功也没子类型，只能记一条调试，无法归因
      } else {
        onDebug(
          `[bridge:activity] sessionId=${sessionId} result subtype=undefined`,
        )
      }
      break
    }
    default:
      break
  }

  return activities
}

/**
 * Extract plain text from a replayed SDKUserMessage NDJSON line. Returns the
 * trimmed text if this looks like a real human-authored message, otherwise
 * undefined so the caller keeps waiting for the first real message.
 */
// 从回放的用户消息里抽纯文本，用于判断第一条真正由人写的消息
function extractUserMessageText(
  msg: Record<string, unknown>,
): string | undefined {
  // Skip tool-result user messages (wrapped subagent results) and synthetic
  // caveat messages — neither is human-authored.
// 三种都要跳过：带父级工具调用标识的是子代理结果，合成与回放的是系统注入的
  if (msg.parent_tool_use_id != null || msg.isSynthetic || msg.isReplay)
    return undefined

  const message = msg.message as Record<string, unknown> | undefined
  const content = message?.content
  let text: string | undefined
// 内容可能是字符串，也可能是块数组；数组里只取第一个文本块
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as Record<string, unknown>).type === 'text'
      ) {
        text = (block as Record<string, unknown>).text as string | undefined
        break
      }
    }
  }
// 去空白后为空就当作没有内容，让调用方继续等下一条
  text = text?.trim()
  return text ? text : undefined
}

/** Build a short preview of tool input for debug logging. */
// 调试用的输入预览：只取字符串字段，最多三个键，每个截一百字符
function inputPreview(input: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, val] of Object.entries(input)) {
    if (typeof val === 'string') {
      parts.push(`${key}="${val.slice(0, 100)}"`)
    }
    if (parts.length >= 3) break
  }
  return parts.join(' ')
}

// 生成器工厂，返回一个只有 spawn 方法的对象
export function createSessionSpawner(deps: SessionSpawnerDeps): SessionSpawner {
  return {
    spawn(opts: SessionSpawnOpts, dir: string): SessionHandle {
      // Debug file resolution:
      // 1. If deps.debugFile is provided, use it with session ID suffix for uniqueness
      // 2. If verbose or ant build, auto-generate a temp file path
      // 3. Otherwise, no debug file
// 文件名里用净化后的标识，原始标识仍用于协议
      const safeId = safeFilenameId(opts.sessionId)
      let debugFile: string | undefined
// 配置了调试文件就把会话标识插在扩展名之前，保证多会话不互相覆盖
      if (deps.debugFile) {
        const ext = deps.debugFile.lastIndexOf('.')
        if (ext > 0) {
          debugFile = `${deps.debugFile.slice(0, ext)}-${safeId}${deps.debugFile.slice(ext)}`
        } else {
          debugFile = `${deps.debugFile}-${safeId}`
        }
// 没配调试文件时，详细模式或内部构建才自动落到临时目录
      } else if (deps.verbose || process.env.USER_TYPE === 'ant') {
        debugFile = join(tmpdir(), 'claude', `bridge-session-${safeId}.log`)
      }

      // Transcript file: write raw NDJSON lines for post-hoc analysis.
      // Placed alongside the debug file when one is configured.
      let transcriptStream: WriteStream | null = null
      let transcriptPath: string | undefined
// 转写文件只在配了调试文件时才开：它的用途是事后分析，与调试日志同生命周期
      if (deps.debugFile) {
        transcriptPath = join(
          dirname(deps.debugFile),
          `bridge-transcript-${safeId}.jsonl`,
        )
// 以追加方式打开，同一会话重启不丢前一段
        transcriptStream = createWriteStream(transcriptPath, { flags: 'a' })
// 写失败只记一条调试并把流置空，不让转写问题影响会话本身
        transcriptStream.on('error', err => {
          deps.onDebug(
            `[bridge:session] Transcript write error: ${err.message}`,
          )
          transcriptStream = null
        })
        deps.onDebug(`[bridge:session] Transcript log: ${transcriptPath}`)
      }

// 参数固定为打印模式加流式输入输出，再按需追加详细、调试文件与权限模式
      const args = [
        ...deps.scriptArgs,
        '--print',
        '--sdk-url',
        opts.sdkUrl,
        '--session-id',
        opts.sessionId,
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
// 回放用户消息这一项是刚需：桥接靠它看到用户发了什么
        '--replay-user-messages',
        ...(deps.verbose ? ['--verbose'] : []),
        ...(debugFile ? ['--debug-file', debugFile] : []),
        ...(deps.permissionMode
          ? ['--permission-mode', deps.permissionMode]
          : []),
      ]

// 环境变量在父进程环境之上覆盖，不继承父进程的令牌
      const env: NodeJS.ProcessEnv = {
        ...deps.env,
        // Strip the bridge's OAuth token so the child CC process uses
        // the session access token for inference instead.
// 把桥接自己的令牌置空：子进程要用的是会话访问令牌，两个令牌混用会让计费与归属错位
        CLAUDE_CODE_OAUTH_TOKEN: undefined,
// 标记这是桥接环境启动的会话，子进程据此调整行为
        CLAUDE_CODE_ENVIRONMENT_KIND: 'bridge',
        ...(deps.sandbox && { CLAUDE_CODE_FORCE_SANDBOX: '1' }),
        CLAUDE_CODE_SESSION_ACCESS_TOKEN: opts.accessToken,
        // v1: HybridTransport (WS reads + POST writes) to Session-Ingress.
        // Harmless in v2 mode — transportUtils checks CLAUDE_CODE_USE_CCR_V2 first.
        CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2: '1',
        // v2: SSETransport + CCRClient to CCR's /v1/code/sessions/* endpoints.
        // Same env vars environment-manager sets in the container path.
// 第二版传输的两个变量：走新传输时必须带工作进程纪元，服务端据此拒绝过期进程
        ...(opts.useCcrV2 && {
          CLAUDE_CODE_USE_CCR_V2: '1',
          CLAUDE_CODE_WORKER_EPOCH: String(opts.workerEpoch),
        }),
      }

      deps.onDebug(
        `[bridge:session] Spawning sessionId=${opts.sessionId} sdkUrl=${opts.sdkUrl} accessToken=${opts.accessToken ? 'present' : 'MISSING'}`,
      )
      deps.onDebug(`[bridge:session] Child args: ${args.join(' ')}`)
      if (debugFile) {
        deps.onDebug(`[bridge:session] Debug log: ${debugFile}`)
      }

      // Pipe all three streams: stdin for control, stdout for NDJSON parsing,
      // stderr for error capture and diagnostics.
// 三个流全部用管道：标准输入发控制消息，标准输出读流式消息，标准错误收集诊断
      const child: ChildProcess = spawn(deps.execPath, args, {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        windowsHide: true,
      })

      deps.onDebug(
        `[bridge:session] sessionId=${opts.sessionId} pid=${child.pid}`,
      )

// 活动环形缓冲、当前活动、错误尾行、两个一次性标记都放在闭包里
      const activities: SessionActivity[] = []
      let currentActivity: SessionActivity | null = null
      const lastStderr: string[] = []
      let sigkillSent = false
      let firstUserMessageSeen = false

      // Buffer stderr for error diagnostics
// 标准错误逐行读，详细模式下同时转发到父进程的终端
      if (child.stderr) {
        const stderrRl = createInterface({ input: child.stderr })
        stderrRl.on('line', line => {
          // Forward stderr to bridge's stderr in verbose mode
          if (deps.verbose) {
            process.stderr.write(line + '\n')
          }
          // Ring buffer of last N lines
          if (lastStderr.length >= MAX_STDERR_LINES) {
            lastStderr.shift()
          }
          lastStderr.push(line)
        })
      }

      // Parse NDJSON from child stdout
      if (child.stdout) {
// 标准输出逐行读，每行先落转写文件再解析
        const rl = createInterface({ input: child.stdout })
        rl.on('line', line => {
          // Write raw NDJSON to transcript file
// 转写写的是原始行，解析失败的行也留着，事后才能看出子进程到底吐了什么
          if (transcriptStream) {
            transcriptStream.write(line + '\n')
          }

          // Log all messages flowing from the child CLI to the bridge
          deps.onDebug(
            `[bridge:ws] sessionId=${opts.sessionId} <<< ${debugTruncate(line)}`,
          )

          // In verbose mode, forward raw output to stderr
          if (deps.verbose) {
            process.stderr.write(line + '\n')
          }

// 活动抽取与权限检测分两步走：抽取会吞掉解析错误，所以下面再解析一次，代价很小但让两条路径互不依赖
          const extracted = extractActivities(
            line,
            opts.sessionId,
            deps.onDebug,
          )
          for (const activity of extracted) {
            // Maintain ring buffer
// 超过上限就丢最旧的一条，形成一个滑动窗口
            if (activities.length >= MAX_ACTIVITIES) {
              activities.shift()
            }
            activities.push(activity)
            currentActivity = activity

            deps.onActivity?.(opts.sessionId, activity)
          }

          // Detect control_request and replayed user messages.
          // extractActivities parses the same line but swallows parse errors
          // and skips 'user' type — re-parse here is cheap (NDJSON lines are
          // small) and keeps each path self-contained.
// 这一整块是为了识别控制请求与首条用户消息，故意用独立作用域隔离变量
          {
            let parsed: unknown
            try {
              parsed = jsonParse(line)
            } catch {
              // Non-JSON line, skip detection
            }
            if (parsed && typeof parsed === 'object') {
              const msg = parsed as Record<string, unknown>

// 控制请求里只转发放行判定，中断这类回合级消息由子进程自己处理
              if (msg.type === 'control_request') {
                const request = msg.request as
                  | Record<string, unknown>
                  | undefined
                if (
// 子类型不是放行判定就不管，避免把别的控制请求误当权限问题弹给用户
                  request?.subtype === 'can_use_tool' &&
                  deps.onPermissionRequest
                ) {
                  deps.onPermissionRequest(
                    opts.sessionId,
                    parsed as PermissionRequest,
                    opts.accessToken,
                  )
                }
                // interrupt is turn-level; the child handles it internally (print.ts)
// 首条用户消息只报一次：桥接用它来推导会话标题
              } else if (
                msg.type === 'user' &&
                !firstUserMessageSeen &&
                opts.onFirstUserMessage
              ) {
                const text = extractUserMessageText(msg)
                if (text) {
                  firstUserMessageSeen = true
                  opts.onFirstUserMessage(text)
                }
              }
            }
          }
        })
      }

// 结束状态用一个承诺表达，三个来源都汇到这里：正常关闭、信号中断、启动失败
      const done = new Promise<SessionDoneStatus>(resolve => {
        child.on('close', (code, signal) => {
          // Close transcript stream on exit
          if (transcriptStream) {
            transcriptStream.end()
            transcriptStream = null
          }

// 被信号杀掉算中断而不是失败：用户主动停止与出错要区分
          if (signal === 'SIGTERM' || signal === 'SIGINT') {
            deps.onDebug(
              `[bridge:session] sessionId=${opts.sessionId} interrupted signal=${signal} pid=${child.pid}`,
            )
            resolve('interrupted')
// 退出码为零算完成，其余算失败
          } else if (code === 0) {
            deps.onDebug(
              `[bridge:session] sessionId=${opts.sessionId} completed exit_code=0 pid=${child.pid}`,
            )
            resolve('completed')
          } else {
            deps.onDebug(
              `[bridge:session] sessionId=${opts.sessionId} failed exit_code=${code} pid=${child.pid}`,
            )
            resolve('failed')
          }
        })

// 连进程都没起来（比如可执行文件不存在）也归到失败
        child.on('error', err => {
          deps.onDebug(
            `[bridge:session] sessionId=${opts.sessionId} spawn error: ${err.message}`,
          )
          resolve('failed')
        })
      })

      const handle: SessionHandle = {
        sessionId: opts.sessionId,
        done,
        activities,
        accessToken: opts.accessToken,
        lastStderr,
        get currentActivity(): SessionActivity | null {
          return currentActivity
        },
// 优雅停止：Windows 上带信号名会抛错，只能用默认终止
        kill(): void {
          if (!child.killed) {
            deps.onDebug(
              `[bridge:session] Sending SIGTERM to sessionId=${opts.sessionId} pid=${child.pid}`,
            )
            // On Windows, child.kill('SIGTERM') throws; use default signal.
            if (process.platform === 'win32') {
              child.kill()
            } else {
              child.kill('SIGTERM')
            }
          }
        },
// 强杀用独立标记：进程对象的已杀标志在调用终止时就置位了，不看它就无法在优雅停止之后再补一刀
        forceKill(): void {
          // Use separate flag because child.killed is set when kill() is called,
          // not when the process exits. We need to send SIGKILL even after SIGTERM.
          if (!sigkillSent && child.pid) {
            sigkillSent = true
            deps.onDebug(
              `[bridge:session] Sending SIGKILL to sessionId=${opts.sessionId} pid=${child.pid}`,
            )
            if (process.platform === 'win32') {
              child.kill()
            } else {
              child.kill('SIGKILL')
            }
          }
        },
// 写标准输入前先确认流没被销毁：子进程退出后写入会抛未捕获异常
        writeStdin(data: string): void {
          if (child.stdin && !child.stdin.destroyed) {
            deps.onDebug(
              `[bridge:ws] sessionId=${opts.sessionId} >>> ${debugTruncate(data)}`,
            )
            child.stdin.write(data)
          }
        },
// 令牌刷新走标准输入的一条环境变量更新消息，子进程收到后直接改进程环境，下一次取认证头就拿到新值
        updateAccessToken(token: string): void {
          handle.accessToken = token
          // Send the fresh token to the child process via stdin. The child's
          // StructuredIO handles update_environment_variables messages by
          // setting process.env directly, so getSessionIngressAuthToken()
          // picks up the new token on the next refreshHeaders call.
          handle.writeStdin(
            jsonStringify({
              type: 'update_environment_variables',
              variables: { CLAUDE_CODE_SESSION_ACCESS_TOKEN: token },
            }) + '\n',
          )
          deps.onDebug(
            `[bridge:session] Sent token refresh via stdin for sessionId=${opts.sessionId}`,
          )
        },
      }

      return handle
    },
  }
}

// 把活动抽取单独导出给测试用，命名上明确标注了用途
export { extractActivities as _extractActivitiesForTesting }
