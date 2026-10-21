// ═══════════════════════════════════════════════════════════════
//  dumpPrompts：把每次请求写到 jsonl，给 /issue 排查用
// ═══════════════════════════════════════════════════════════════
//
//  这是一个**纯粹的调试工具**，而且在三处都做了「不要影响主流程」的让步：
//
//      1. 只对内部用户开（USER_TYPE === 'ant'）
//      2. 解析和序列化用 setImmediate 推迟到请求之外
//      3. 所有失败都吞掉（catch 里是空的）
//
//  它值得读的地方在「怎么在不拖慢主路径的前提下干重活」这一套手法。
import type { ClientOptions } from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { getSessionId } from 'src/bootstrap/state.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'

// 【用 sha256 算初始化数据的哈希，是为了「只在变化时写一条」】
//
//  一次请求的 body 包括：system prompt（几千字）+ 全部工具 schema（几百 KB）
//  + messages。其中 system 和 tools 在**同一会话里几乎不变**，变的只有 messages。
//
//  所以策略是：把「除 messages 外的全部」作为一个 init 块，
//  第一次写一条，之后只在哈希变化时写一条 system_update。
//
//  这样日志文件的大小从「O(轮数 × 全量)」降到「O(全量 + 轮数 × 增量)」。
//  一次 100 轮的会话，前者可能是几百 MB，后者几 MB。
//
//  **日志设计的第一原则是「同一份不变的东西只写一次」**，否则读日志的人
//  要先做去重才能看见变化。
function hashString(str: string): string {
  return createHash('sha256').update(str).digest('hex')
}

// Cache last few API requests for ant users (e.g., for /issue command)
const MAX_CACHED_REQUESTS = 5
const cachedApiRequests: Array<{ timestamp: string; request: unknown }> = []

// 【DumpState 里有两个「上次」—— 一个是哈希，一个是更便宜的指纹】
//
//      lastInitDataHash      真正的 sha256，用来判断「要不要写 system_update」
//      lastInitFingerprint   便宜的代理值，用来判断「值不值得去算 sha256」
//
//  为什么需要指纹？因为算 sha256 之前要先把整个 initData 序列化成字符串，
//  而注释（第 107 行）说这一步要 300ms。
//
//  指纹是什么：`model|工具名列表|system 总长度`。三样东西拼起来，
//  只要形状没变就跳过序列化。**用 0.01ms 的判断省掉 300ms 的操作。**
//
//  这是「两级判断」的标准形态：**便宜但可能误判的过滤器放前面，
//  昂贵但准确的判断放后面。** 指纹误判（形状一样但内容变了）的后果是
//  漏写一条 system_update —— 对调试日志可接受，所以敢用。
type DumpState = {
  initialized: boolean
  messageCountSeen: number
  lastInitDataHash: string
  // Cheap proxy for change detection — skips the expensive stringify+hash
  // when model/tools/system are structurally identical to the last call.
  lastInitFingerprint: string
}

// Track state per session to avoid duplicating data
const dumpState = new Map<string, DumpState>()

export function getLastApiRequests(): Array<{
  timestamp: string
  request: unknown
}> {
  return [...cachedApiRequests]
}

export function clearApiRequestCache(): void {
  cachedApiRequests.length = 0
}

export function clearDumpState(agentIdOrSessionId: string): void {
  dumpState.delete(agentIdOrSessionId)
}

export function clearAllDumpState(): void {
  dumpState.clear()
}

// 【只缓存最近 5 条请求，而且是环形缓冲】
//
//      push 新的 → 如果超过 5 → shift 掉最旧的
//
//  用数组 push + shift 而不是真环形缓冲，因为 MAX 只有 5，O(n) 无所谓。
//  **不要为了常数 5 去写一个泛型环形缓冲类** —— 这是很常见的过度设计。
//
//  第 49 行那个 `if (process.env.USER_TYPE !== 'ant') return` 在函数最前面，
//  所以对外部用户来说这个函数是彻底的 no-op：不存对象、不占内存。
//
//  注意这两个「只对内部开」的判断在本文件里出现了**两次**
//  （第 49 行和第 100 行），不是冗余：第 49 行拦的是「进缓存」，
//  第 100 行拦的是「写文件」，两条路径一个是内存一个是磁盘。
export function addApiRequestToCache(requestData: unknown): void {
  if (process.env.USER_TYPE !== 'ant') return
  cachedApiRequests.push({
    timestamp: new Date().toISOString(),
    request: requestData,
  })
  if (cachedApiRequests.length > MAX_CACHED_REQUESTS) {
    cachedApiRequests.shift()
  }
}

export function getDumpPromptsPath(agentIdOrSessionId?: string): string {
  return join(
    getClaudeConfigHomeDir(),
    'dump-prompts',
    `${agentIdOrSessionId ?? getSessionId()}.jsonl`,
  )
}

// 【appendToFile：故意不 await，也故意不报告失败】
//
//      fs.mkdir(...).then(() => fs.appendFile(...)).catch(() => {})
//
//  三个决定：
//
//      不 await          → 不阻塞调用方（调用方在 setImmediate 里，本来也不急）
//      mkdir recursive   → 目录可能不存在，每次都建一次也无所谓（幂等）
//      catch 空函数      → 写日志失败绝不能让主流程出错
//
//  这是「尽力而为（best effort）」的标准写法。关键在于：
//  **空 catch 是危险的，但在这里是正当的** —— 因为这是一个调试功能，
//  它的失败没有任何用户可见的后果。判断空 catch 是否正当，就看
//  「吞掉这个错误会不会让人做出错误决策」。这里不会。
//
//  反例：如果这是「写用户数据」，空 catch 就是不可接受的。
function appendToFile(filePath: string, entries: string[]): void {
  if (entries.length === 0) return
  fs.mkdir(dirname(filePath), { recursive: true })
    .then(() => fs.appendFile(filePath, entries.join('\n') + '\n'))
    .catch(() => {})
}

function initFingerprint(req: Record<string, unknown>): string {
  const tools = req.tools as Array<{ name?: string }> | undefined
  const system = req.system as unknown[] | string | undefined
  const sysLen =
    typeof system === 'string'
      ? system.length
      : Array.isArray(system)
        ? system.reduce(
            (n: number, b) => n + ((b as { text?: string }).text?.length ?? 0),
            0,
          )
        : 0
  const toolNames = tools?.map(t => t.name ?? '').join(',') ?? ''
  return `${req.model}|${toolNames}|${sysLen}`
}

// 【dumpRequest：先 jsonParse 再 jsonStringify，看起来多此一举】
//
//  为什么不直接把原始 body 字符串存下来？因为要**按字段拆开**：
//
//      把 messages 摘出来，剩下的作为 init
//      只存 role === 'user' 的消息（assistant 的内容从响应里取）
//
//  所以必须解析。而这个解析的成本（MB 级 JSON）就是前面那些
//  「推迟到 setImmediate」「用指纹跳过」的优化对象。
//
//  第 110 行的写法值得学：
//
//      const { messages: _, ...initData } = req
//
//  用**解构 + 重命名丢弃**来「取反集」。`messages: _` 表示「我要 messages
//  这个名字被占住但不用它」，剩下的进 initData。比 delete req.messages 好，
//  因为不改原对象。
function dumpRequest(
  body: string,
  ts: string,
  state: DumpState,
  filePath: string,
): void {
  try {
    const req = jsonParse(body) as Record<string, unknown>
    addApiRequestToCache(req)

    if (process.env.USER_TYPE !== 'ant') return
    const entries: string[] = []
    const messages = (req.messages ?? []) as Array<{ role?: string }>

    // Write init data (system, tools, metadata) on first request,
    // and a system_update entry whenever it changes.
    // Cheap fingerprint first: system+tools don't change between turns,
    // so skip the 300ms stringify when the shape is unchanged.
    const fingerprint = initFingerprint(req)
    if (!state.initialized || fingerprint !== state.lastInitFingerprint) {
      const { messages: _, ...initData } = req
      const initDataStr = jsonStringify(initData)
      const initDataHash = hashString(initDataStr)
      state.lastInitFingerprint = fingerprint
      if (!state.initialized) {
        state.initialized = true
        state.lastInitDataHash = initDataHash
        // Reuse initDataStr rather than re-serializing initData inside a wrapper.
        // timestamp from toISOString() contains no chars needing JSON escaping.
        entries.push(
          `{"type":"init","timestamp":"${ts}","data":${initDataStr}}`,
        )
      } else if (initDataHash !== state.lastInitDataHash) {
        state.lastInitDataHash = initDataHash
        entries.push(
          `{"type":"system_update","timestamp":"${ts}","data":${initDataStr}}`,
        )
      }
    }

    // Write only new user messages (assistant messages captured in response)
    for (const msg of messages.slice(state.messageCountSeen)) {
      if (msg.role === 'user') {
        entries.push(
          jsonStringify({ type: 'message', timestamp: ts, data: msg }),
        )
      }
    }
    state.messageCountSeen = messages.length

    appendToFile(filePath, entries)
  } catch {
    // Ignore parsing errors
  }
}

// 【核心手法：包一层 fetch，而不是在调用点埋点】
//
//  返回值是一个**新的 fetch 函数**，签名和标准 fetch 一致，所以可以直接
//  塞进 SDK 的 ClientOptions.fetch。这叫「装饰器式的横切」：
//
//      所有请求都经过这里 → 不用改任何调用点 → 也不会漏掉某个调用点
//
//  这比「在每个发请求的地方加一行 dump」可靠得多 —— 后者一旦新增一个
//  调用点忘了加，日志就有洞。
//
//  注意它对响应的处理（第 175 行）：response.clone()。
//  因为响应体是流，读一次就没了。clone 之后一路给 dump 用、一路返回给
//  调用方，两边互不影响。**任何要「顺便看一眼响应体」的中间件都必须 clone。**
export function createDumpPromptsFetch(
  agentIdOrSessionId: string,
): ClientOptions['fetch'] {
  const filePath = getDumpPromptsPath(agentIdOrSessionId)

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const state = dumpState.get(agentIdOrSessionId) ?? {
      initialized: false,
      messageCountSeen: 0,
      lastInitDataHash: '',
      lastInitFingerprint: '',
    }
    dumpState.set(agentIdOrSessionId, state)

//     // 【只在 POST 且有 body 时 dump —— 一个精确的过滤条件】
//     //
//     //  GET 请求（查配置、查配额）不算「一次对话」，没必要记。
//     //  没有 body 的 POST 也不会有 prompt。
//     //
//     //  注意时间戳是在这里生成的，然后传给 dumpRequest 和后面的 response 记录 ——
//     //  **一次请求用一个时间戳**，这样请求和响应能在日志里配对。
//     //  如果各自取一次 Date.now()，配对的顺序就得靠猜。
    let timestamp: string | undefined

    if (init?.method === 'POST' && init.body) {
      timestamp = new Date().toISOString()
      // Parsing + stringifying the request (system prompt + tool schemas = MBs)
      // takes hundreds of ms. Defer so it doesn't block the actual API call —
      // this is debug tooling for /issue, not on the critical path.
      setImmediate(dumpRequest, init.body as string, timestamp, state, filePath)
    }

    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const response = await globalThis.fetch(input, init)

    // Save response async
    if (timestamp && response.ok && process.env.USER_TYPE === 'ant') {
      const cloned = response.clone()
      void (async () => {
        try {
          const isStreaming = cloned.headers
            .get('content-type')
            ?.includes('text/event-stream')

          let data: unknown
//           // 【流式响应要自己拼 SSE，非流式直接 json】
//           //
//           //  SSE（Server-Sent Events）的格式是：
//           //
//           //      data: {...}
//           //      （空行）
//           //      data: {...}
//           //      （空行）
//           //      data: [DONE]
//           //
//           //  所以按两个换行切事件、按单换行切行、取 data: 前缀、跳过 [DONE]。
//           //
//           //  两个细节：
//           //    1. 用 TextDecoder 的 { stream: true } —— 因为一个 UTF-8 字符
//           //       可能被切在两个 chunk 之间，不带 stream 会解出乱码
//           //    2. line.slice(6) 而不是 slice(5) —— 'data: ' 带空格是 6 个字符，
//           //       按码元数硬编码的偏移，脆弱但省一个正则
//           //
//           //  注释（第 164 行）说了这个函数的定位：debug tooling for /issue,
//           //  not on the critical path。**定位决定容忍度** —— 因为它不在
//           //  关键路径上，所以这里可以接受硬编码偏移这种写法。
          if (isStreaming && cloned.body) {
            // Parse SSE stream into chunks
            const reader = cloned.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
              }
            } finally {
              reader.releaseLock()
            }
            const chunks: unknown[] = []
            for (const event of buffer.split('\n\n')) {
              for (const line of event.split('\n')) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                  try {
                    chunks.push(jsonParse(line.slice(6)))
                  } catch {
                    // Ignore parse errors
                  }
                }
              }
            }
            data = { stream: true, chunks }
          } else {
            data = await cloned.json()
          }

//           // 【这里 await 了 fs.appendFile，和上面 appendToFile 的 fire-and-forget 不同】
//           //
//           //  区别在于：这里是**响应体**，数据已经在内存里了（buffer 全读完了），
//           //  没有「不阻塞调用方」的压力（调用方早就拿到 response 了）。
//           //
//           //  所以这一处的 await 是为了**让错误进 catch**，而不是为了等待。
//           //  整个函数体包在一个 try 里，最后 catch 是空的注释 Best effort。
//           //
//           //  一处 fire-and-forget、一处 await + try，同一个文件里两种写法 ——
//           //  差别不在风格，在「这段代码是否还需要向调用方负责」。
          await fs.appendFile(
            filePath,
            jsonStringify({ type: 'response', timestamp, data }) + '\n',
          )
        } catch {
          // Best effort
        }
      })()
    }

    return response
  }
}
