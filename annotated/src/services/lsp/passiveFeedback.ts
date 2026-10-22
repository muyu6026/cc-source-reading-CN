import { fileURLToPath } from 'url'
import type { PublishDiagnosticsParams } from 'vscode-languageserver-protocol'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import type { DiagnosticFile } from '../diagnosticTracking.js'
import { registerPendingLSPDiagnostic } from './LSPDiagnosticRegistry.js'
import type { LSPServerManager } from './LSPServerManager.js'

// 【第 11-35 行】「passive feedback」这个名字就是这条链路的设计意图
//
// LSP 有两种用信息的方式：
// - **主动（active）**：模型调 `LSPTool` 问「这个符号的定义在哪」—— 需要模型先想到要问；
// - **被动（passive）**：语言服务器自己把诊断推过来，模型什么都不用做就能看到。
//
// 这个文件实现的是后者：把 server 推送的 `publishDiagnostics`
// 接住、转成 Claude 的诊断格式、投进 attachment 系统。
//
// 价值在于「模型不知道自己不知道」。一个类型错误如果没人告诉模型，
// 它会在错误的代码上继续写，越写越远。被动诊断相当于给它一个
// **不需要主动查询的、免费的**环境反馈。
//
// 判据：**凡是可以「推」给模型的信息，就不要设计成「让它拉」。**
/**
 * Map LSP severity to Claude diagnostic severity
 *
 * Maps LSP severity numbers to Claude diagnostic severity strings.
 * Accepts numeric severity values (1=Error, 2=Warning, 3=Information, 4=Hint)
 * or undefined, defaulting to 'Error' for invalid/missing values.
 */
// 【第 18-35 行】缺失/非法 severity 一律当 `Error` —— 默认值往「更严重」那边选
//
// LSP 的 `severity` 是可选字段（1=Error / 2=Warning / 3=Information / 4=Hint），
// `undefined` 在协议里是合法的。
//
// 这里的 `default: return 'Error'` 有两层考虑：
// - **漏报比误报贵**：把一条 Hint 误当 Error 上报，模型多看一眼；
//   把一条真的 Error 当 Hint 丢掉，模型永远不知道。
// - **`default` 也接住了非法值**：server 发 `severity: 0` 或 `severity: 7`，
//   同样落到 `Error`。
//
// 对照 `LSPDiagnosticRegistry.severityToNumber()` 里的 `default: return 4`（Hint）——
// 那个地方默认当 Hint 是**排序用**的（未知严重性排最后，不占前 10 条的名额）。
// 同一个「未知」在两个语境下选了相反的默认值，因为**代价不对称的方向不同**：
// 这里是「上报优先级」，那里是「占用配额」。
//
// **默认值不是「中立的中间态」，它一定在替某一方承担风险。**
function mapLSPSeverity(
  lspSeverity: number | undefined,
): 'Error' | 'Warning' | 'Info' | 'Hint' {
  // LSP DiagnosticSeverity enum:
  // 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
  switch (lspSeverity) {
    case 1:
      return 'Error'
    case 2:
      return 'Warning'
    case 3:
      return 'Info'
    case 4:
      return 'Hint'
    default:
      return 'Error'
  }
}

/**
 * Convert LSP diagnostics to Claude diagnostic format
 *
 * Converts LSP PublishDiagnosticsParams to DiagnosticFile[] format
 * used by Claude's attachment system.
 */
// 【第 43-100 行】URI 两种形态都收，转换失败就回退原串
//
// `params.uri.startsWith('file://') ? fileURLToPath(params.uri) : params.uri`
//
// 为什么要兼容「纯路径」：LSP 规范要求 file URI，但现实里有一批 server
// （尤其是老版本、或者在某些平台上）发的是裸路径。
//
// 为什么要 `try/catch` 并回退：`fileURLToPath` 对畸形 URI 会抛
// （比如 `file://` 后面跟了非法百分号编码）。一个 URI 畸形就丢掉整批诊断，
// 代价太大；回退成原串至少还能让下游看到「有个文件的诊断在这儿」。
//
// 注释原话：*LSP servers may send malformed URIs*。
//
// 顺带注意 `code: diag.code !== undefined && diag.code !== null ? String(diag.code) : undefined`
// —— 这里用 `!== undefined && !== null` 而不是 `if (diag.code)`，
// 因为 `code: 0` 是**合法的**（有些 server 用 0 表示自定义错误码）。
// 用假值判断会把 0 和空字符串一起吞掉 —— 和前面 `firstTokenDate.ts` 里
// 那个 `!== undefined` 是同一类教训。
export function formatDiagnosticsForAttachment(
  params: PublishDiagnosticsParams,
): DiagnosticFile[] {
  // Parse URI (may be file:// or plain path) and normalize to file system path
  let uri: string
  try {
    // Handle both file:// URIs and plain paths
    uri = params.uri.startsWith('file://')
      ? fileURLToPath(params.uri)
      : params.uri
  } catch (error) {
    const err = toError(error)
    logError(err)
    logForDebugging(
      `Failed to convert URI to file path: ${params.uri}. Error: ${err.message}. Using original URI as fallback.`,
    )
    // Gracefully fallback to original URI - LSP servers may send malformed URIs
    uri = params.uri
  }

  const diagnostics = params.diagnostics.map(
    (diag: {
      message: string
      severity?: number
      range: {
        start: { line: number; character: number }
        end: { line: number; character: number }
      }
      source?: string
      code?: string | number
    }) => ({
      message: diag.message,
      severity: mapLSPSeverity(diag.severity),
      range: {
        start: {
          line: diag.range.start.line,
          character: diag.range.start.character,
        },
        end: {
          line: diag.range.end.line,
          character: diag.range.end.character,
        },
      },
      source: diag.source,
      code:
        diag.code !== undefined && diag.code !== null
          ? String(diag.code)
          : undefined,
    }),
  )

  return [
    {
      uri,
      diagnostics,
    },
  ]
}

/**
 * Handler registration result with tracking data
 */
export type HandlerRegistrationResult = {
  /** Total number of servers */
  totalServers: number
  /** Number of successful registrations */
  successCount: number
  /** Registration errors per server */
  registrationErrors: Array<{ serverName: string; error: string }>
  /** Runtime failure tracking (shared across all handler invocations) */
  diagnosticFailures: Map<string, { count: number; lastError: string }>
}

/**
 * Register LSP notification handlers on all servers
 *
 * Sets up handlers to listen for textDocument/publishDiagnostics notifications
 * from all LSP servers and routes them to Claude's diagnostic system.
 * Uses public getAllServers() API for clean access to server instances.
 *
 * @returns Tracking data for registration status and runtime failures
 */
// 【第 125-139 行】只订阅**一个**通知方法，且每个 server 都订
//
// `'textDocument/publishDiagnostics'` 是 LSP 里唯一会「主动推诊断」的通知。
// `window/logMessage`、`$/progress` 这些也会有，但那些是日志/进度，
// 不该进模型上下文 —— 不订阅就等于过滤掉了。
//
// 为什么对**所有** server 都注册（而不是只给「当前文件相关的那个」）：
// 诊断是 server 主动推的，你事先不知道哪个 server 会推。
// 多订几个空的 handler 成本几乎为零，漏订一个就永久失去那门语言的诊断。
//
// `successCount` 和 `registrationErrors` 一起返回，是为了让调用方
// （`manager.ts` 初始化完成时）能判断「注册全成功了吗」，
// 而不是默默有一部分语言没诊断。
export function registerLSPNotificationHandlers(
  manager: LSPServerManager,
): HandlerRegistrationResult {
  // Register handlers on all configured servers to capture diagnostics from any language
  const servers = manager.getAllServers()

  // Track partial failures - allow successful server registrations even if some fail
  const registrationErrors: Array<{ serverName: string; error: string }> = []
  let successCount = 0

  // Track consecutive failures per server to warn users after 3+ failures
  const diagnosticFailures: Map<string, { count: number; lastError: string }> =
    new Map()

  for (const [serverName, serverInstance] of servers.entries()) {
    try {
      // Validate server instance has onNotification method
// 【第 142-158 行】对着一个类型上一定存在的方法做运行时检查
//
// ```js
// if (!serverInstance || typeof serverInstance.onNotification !== 'function') { ... }
// ```
//
// `getAllServers()` 的类型是 `Map<string, LSPServerInstance>`，
// 按 TS 的说法 `onNotification` 一定存在，这个检查「理论上多余」。
//
// 但它守的是三件真实会发生的事：
// 1. `getAllServers()` 返回的是内部 Map 本身（不是副本，见 `LSPServerManager` 第 266 行），
//    调用方有能力往里面塞别的东西；
// 2. 测试里经常传 mock 实例；
// 3. 跨模块边界的对象，类型只是**声明**，不是运行时保证。
//
// 代价是 3 行，收益是「一个坏实例不会让整个注册循环崩掉」（注意它 `continue` 而不是 `throw`）。
// **在模块边界上做运行时校验，和「不信任外部输入」是同一条原则**，
// 只是这里的「外部」是另一个模块。
      if (
        !serverInstance ||
        typeof serverInstance.onNotification !== 'function'
      ) {
        const errorMsg = !serverInstance
          ? 'Server instance is null/undefined'
          : 'Server instance has no onNotification method'

        registrationErrors.push({ serverName, error: errorMsg })

        const err = new Error(`${errorMsg} for ${serverName}`)
        logError(err)
        logForDebugging(
          `Skipping handler registration for ${serverName}: ${errorMsg}`,
        )
        continue // Skip this server but track the failure
      }

      // Errors are isolated to avoid breaking other servers
      serverInstance.onNotification(
        'textDocument/publishDiagnostics',
        (params: unknown) => {
          logForDebugging(
            `[PASSIVE DIAGNOSTICS] Handler invoked for ${serverName}! Params type: ${typeof params}`,
          )
          try {
            // Validate params structure before casting
// 【第 169-183 行】参数形状用 `in` 检查，不上 zod
//
// ```js
// if (!params || typeof params !== 'object' || !('uri' in params) || !('diagnostics' in params))
// ```
//
// 只要确认这两个键存在就够了，为什么不用 schema 校验：
// - 这是**热路径**。每个 server 每次重新分析都可能推一批，大项目里一秒几次不少见；
// - `params` 来自 JSON-RPC 层，已经是 `JSON.parse` 过的普通对象，
//   不会有原型污染之类的问题；
// - 真正需要严格校验的字段（`range` 的四个数字）在下面 map 时才用到，
//   那时出错会被外层 try/catch 接住。
//
// 判据是**「校验的成本要和被保护的东西匹配」**：
// 两个字段的存在性用 `in` 是相称的；如果是「这个对象要写进数据库」，
// 那就该上 zod。
//
// 注意 `in` 而不是 `params.uri !== undefined` —— `in` 会走原型链，
// 能抓到 `Object.create({uri:...})` 这种情况，虽然这里无所谓，但更省事。
            if (
              !params ||
              typeof params !== 'object' ||
              !('uri' in params) ||
              !('diagnostics' in params)
            ) {
              const err = new Error(
                `LSP server ${serverName} sent invalid diagnostic params (missing uri or diagnostics)`,
              )
              logError(err)
              logForDebugging(
                `Invalid diagnostic params from ${serverName}: ${jsonStringify(params)}`,
              )
              return
            }

            const diagnosticParams = params as PublishDiagnosticsParams
            logForDebugging(
              `Received diagnostics from ${serverName}: ${diagnosticParams.diagnostics.length} diagnostic(s) for ${diagnosticParams.uri}`,
            )

            // Convert LSP diagnostics to Claude format (can throw on invalid URIs)
            const diagnosticFiles =
              formatDiagnosticsForAttachment(diagnosticParams)

            // Only send notification if there are diagnostics
            const firstFile = diagnosticFiles[0]
            if (
              !firstFile ||
              diagnosticFiles.length === 0 ||
              firstFile.diagnostics.length === 0
            ) {
              logForDebugging(
                `Skipping empty diagnostics from ${serverName} for ${diagnosticParams.uri}`,
              )
              return
            }

            // Register diagnostics for async delivery via attachment system
            // Follows same pattern as AsyncHookRegistry for consistent async attachment delivery
            try {
              registerPendingLSPDiagnostic({
                serverName,
                files: diagnosticFiles,
              })

              logForDebugging(
                `LSP Diagnostics: Registered ${diagnosticFiles.length} diagnostic file(s) from ${serverName} for async delivery`,
              )

              // Success - reset failure counter for this server
              diagnosticFailures.delete(serverName)
            } catch (error) {
              const err = toError(error)
              logError(err)
              logForDebugging(
                `Error registering LSP diagnostics from ${serverName}: ` +
                  `URI: ${diagnosticParams.uri}, ` +
                  `Diagnostic count: ${firstFile.diagnostics.length}, ` +
                  `Error: ${err.message}`,
              )

              // Track consecutive failures and warn after 3+
              const failures = diagnosticFailures.get(serverName) || {
                count: 0,
                lastError: '',
              }
              failures.count++
              failures.lastError = err.message
              diagnosticFailures.set(serverName, failures)

// 【第 240-247 行】连续失败 3 次才 WARN —— 和「三振熔断」是同一个数字
//
// `if (failures.count >= 3)` —— 前两次静默，第三次才写一条明显的警告。
//
// 为什么不是第一次就报：单次失败在 LSP 世界里是常态
// （server 正在重启、正在索引、某个文件刚好在写），
// 第一次就 WARN 会让日志充满假警报，真正的问题反而看不见。
//
// 为什么不是一直不报：同一个 server 连续 3 次处理诊断失败，
// 基本可以确定是它坏了（协议不兼容、内存爆了、我们这边解析崩了），
// 这时候必须让用户/开发者知道「这门语言的诊断已经不工作了」。
//
// 注意成功一次就 `diagnosticFailures.delete(serverName)` 清零
// （第 220 行）—— 计的是**连续**失败，不是累计。
// 累计计数会让一个「偶发失败率 10%」的健康 server 在长会话里必然触发警告。
//
// `diagnosticFailures` 还作为返回值的一部分交给调用方，
// 说明作者预期「这个数据以后会被用在别处」（比如展示给用户），
// 而不只是打日志用。
              if (failures.count >= 3) {
                logForDebugging(
                  `WARNING: LSP diagnostic handler for ${serverName} has failed ${failures.count} times consecutively. ` +
                    `Last error: ${failures.lastError}. ` +
                    `This may indicate a problem with the LSP server or diagnostic processing. ` +
                    `Check logs for details.`,
                )
              }
            }
// 【第 249-276 行】最外层还套了一个 `catch`，且注释明说「不要 re-throw」
//
// *Don't re-throw - isolate errors to this server only*
//
// 整个 handler 从参数校验到 `registerPendingLSPDiagnostic` 都包在 try 里，
// 最后的 catch 只记日志。
//
// 为什么必须这样：这个函数是 **JSON-RPC 库的通知回调**。
// 在事件回调里抛异常不会传回给调用方，而是变成 `uncaughtException` ——
// 也就是**整个 CLI 崩掉**。一个语言服务器的畸形通知有能力杀死你的终端会话，
// 这个代价完全不成比例。
//
// 所以这里的结构是三道防线：
// 1. 内层 try：`registerPendingLSPDiagnostic` 失败 → 计失败次数，不外抛；
// 2. 外层 try：`formatDiagnosticsForAttachment` 等意外错误 → 计失败次数，不外抛；
// 3. 每次 `this` 回调的入口做形状校验 → 直接 return。
//
// 三道的共同目标只有一个：**这个回调永远不抛**。
// 判断一个回调该不该抛，看它被谁调用 —— 如果调用方是事件循环/协议库，那它就不该抛。
          } catch (error) {
            // Catch any unexpected errors from the entire handler to prevent breaking the notification loop
            const err = toError(error)
            logError(err)
            logForDebugging(
              `Unexpected error processing diagnostics from ${serverName}: ${err.message}`,
            )

            // Track consecutive failures and warn after 3+
            const failures = diagnosticFailures.get(serverName) || {
              count: 0,
              lastError: '',
            }
            failures.count++
            failures.lastError = err.message
            diagnosticFailures.set(serverName, failures)

            if (failures.count >= 3) {
              logForDebugging(
                `WARNING: LSP diagnostic handler for ${serverName} has failed ${failures.count} times consecutively. ` +
                  `Last error: ${failures.lastError}. ` +
                  `This may indicate a problem with the LSP server or diagnostic processing. ` +
                  `Check logs for details.`,
              )
            }

            // Don't re-throw - isolate errors to this server only
          }
        },
      )

      logForDebugging(`Registered diagnostics handler for ${serverName}`)
      successCount++
    } catch (error) {
      const err = toError(error)

      registrationErrors.push({
        serverName,
        error: err.message,
      })

      logError(err)
      logForDebugging(
        `Failed to register diagnostics handler for ${serverName}: ` +
          `Error: ${err.message}`,
      )
    }
  }

  // Report overall registration status
  const totalServers = servers.size
  if (registrationErrors.length > 0) {
    const failedServers = registrationErrors
      .map(e => `${e.serverName} (${e.error})`)
      .join(', ')
    // Log aggregate failures for tracking
    logError(
      new Error(
        `Failed to register diagnostics for ${registrationErrors.length} LSP server(s): ${failedServers}`,
      ),
    )
    logForDebugging(
      `LSP notification handler registration: ${successCount}/${totalServers} succeeded. ` +
        `Failed servers: ${failedServers}. ` +
        `Diagnostics from failed servers will not be delivered.`,
    )
  } else {
    logForDebugging(
      `LSP notification handlers registered successfully for all ${totalServers} server(s)`,
    )
  }

  // Return tracking data for monitoring and testing
  return {
    totalServers,
    successCount,
    registrationErrors,
    diagnosticFailures,
  }
}
