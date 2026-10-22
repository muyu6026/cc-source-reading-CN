import * as path from 'path'
import { pathToFileURL } from 'url'
import type { InitializeParams } from 'vscode-languageserver-protocol'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { sleep } from '../../utils/sleep.js'
import type { createLSPClient as createLSPClientType } from './LSPClient.js'
import type { LspServerState, ScopedLspServerConfig } from './types.js'

// 【第 12-28 行】三个常量，一条完整的「可重试错误」策略
//
// - `-32801` = LSP 的 `ContentModified`。语义是「**你请求的时候服务器内部状态变了**」，
//   最典型的来源是 rust-analyzer 还在索引整个项目。LSP 规范明确说这是
//   **应该由客户端静默重试**的错误，不是真错误。
// - 重试 3 次。
// - `500 * 2^n` → 500 / 1000 / 2000ms，总计最多等 3.5 秒。
//
// 为什么必须退避而不是立刻重试：`ContentModified` 的成因是「对方在忙」。
// 立刻重试只会让对方更忙，三轮零间隔重试大概率三轮全败。
// 指数退避给的是「让它把那批索引任务做完」的时间窗口。
//
// 这三个数字放在文件顶部而不是内联，是为了让「策略」和「机制」分开：
// 下面的循环只负责执行，改策略只改这三行。
/**
 * LSP error code for "content modified" - indicates the server's state changed
 * during request processing (e.g., rust-analyzer still indexing the project).
 * This is a transient error that can be retried.
 */
const LSP_ERROR_CONTENT_MODIFIED = -32801

/**
 * Maximum number of retries for transient LSP errors like "content modified".
 */
const MAX_RETRIES_FOR_TRANSIENT_ERRORS = 3

/**
 * Base delay in milliseconds for exponential backoff on transient errors.
 * Actual delays: 500ms, 1000ms, 2000ms
 */
const RETRY_BASE_DELAY_MS = 500
/**
 * LSP server instance interface returned by createLSPServerInstance.
 * Manages the lifecycle of a single LSP server with state tracking and health monitoring.
 */
export type LSPServerInstance = {
  /** Unique server identifier */
  readonly name: string
  /** Server configuration */
  readonly config: ScopedLspServerConfig
  /** Current server state */
  readonly state: LspServerState
  /** When the server was last started */
  readonly startTime: Date | undefined
  /** Last error encountered */
  readonly lastError: Error | undefined
  /** Number of times restart() has been called */
  readonly restartCount: number
  /** Start the server and initialize it */
  start(): Promise<void>
  /** Stop the server gracefully */
  stop(): Promise<void>
  /** Manually restart the server (stop then start) */
  restart(): Promise<void>
  /** Check if server is healthy and ready for requests */
  isHealthy(): boolean
  /** Send an LSP request to the server */
  sendRequest<T>(method: string, params: unknown): Promise<T>
  /** Send an LSP notification to the server (fire-and-forget) */
  sendNotification(method: string, params: unknown): Promise<void>
  /** Register a handler for LSP notifications */
  onNotification(method: string, handler: (params: unknown) => void): void
  /** Register a handler for LSP requests from the server */
  onRequest<TParams, TResult>(
    method: string,
    handler: (params: TParams) => TResult | Promise<TResult>,
  ): void
}

/**
 * Creates and manages a single LSP server instance.
 *
 * Uses factory function pattern with closures for state encapsulation (avoiding classes).
 * Provides state tracking, health monitoring, and request forwarding for an LSP server.
 * Supports manual restart with configurable retry limits.
 *
 * State machine transitions:
 * - stopped → starting → running
 * - running → stopping → stopped
 * - any → error (on failure)
 * - error → starting (on retry)
 *
 * @param name - Unique identifier for this server instance
 * @param config - Server configuration including command, args, and limits
 * @returns LSP server instance with lifecycle management methods
 *
 * @example
 * const instance = createLSPServerInstance('my-server', config)
 * await instance.start()
 * const result = await instance.sendRequest('textDocument/definition', params)
 * await instance.stop()
 */
export function createLSPServerInstance(
  name: string,
  config: ScopedLspServerConfig,
): LSPServerInstance {
// 【第 94-104 行】配置里有未实现的字段 → **直接抛错**，不忽略
//
// `restartOnCrash` / `shutdownTimeout` 都是配置 schema 里声明过、
// 但代码还没实现的字段。这里的选择是构造实例时 `throw`，
// 错误信息里还带了「请把这个字段从配置里删掉」。
//
// 对照一下另一种常见做法「读到不认识的字段就跳过」：
// 用户写了 `restartOnCrash: true`，以为崩溃会自动重启，实际什么都没发生 ——
// 这种失败**没有任何信号**，只能靠事后发现「怎么没重启」。
//
// 这里的取舍是：宁可启动就失败（错误信息精确指名是哪个字段），
// 也不要一个安静地不生效的配置。
//
// 对写代码的人也一样：**schema 里声明了但没实现，比不声明更危险**，
// 因为它让用户以为「有」。
  // Validate that unimplemented fields are not set
  if (config.restartOnCrash !== undefined) {
    throw new Error(
      `LSP server '${name}': restartOnCrash is not yet implemented. Remove this field from the configuration.`,
    )
  }
  if (config.shutdownTimeout !== undefined) {
    throw new Error(
      `LSP server '${name}': shutdownTimeout is not yet implemented. Remove this field from the configuration.`,
    )
  }

// 【第 106-112 行】`require()` 一个已经有类型导入的模块，只为推迟 129KB 的加载
//
// 文件顶部已经有 `import type { createLSPClient as createLSPClientType } from './LSPClient.js'`，
// 注意是 `import type` —— 编译后**完全消失**，不产生任何运行时依赖。
// 真正的模块在这里用 `require` 现拿。
//
// 为什么不用普通 `import`：注释给了数字，`vscode-jsonrpc` 约 129KB。
// 而 `manager.ts → LSPServerManager.ts → 本文件` 这条静态 import 链
// 在**每个会话**都会被走到（启动时就要建实例）。如果顶部写死 `import`，
// 那 129KB 的解析 + 编译就变成了启动固定开销，哪怕用户一个 LSP 插件都没装。
//
// 换成动态获取之后，只有真的创建 server 实例时才付费。
//
// 代价是丢了静态类型 —— 所以下面用 `as { createLSPClient: typeof createLSPClientType }`
// 把类型补回来。**这是「启动时间 vs 类型安全」的交易，不是疏忽。**
  // Private state encapsulated via closures. Lazy-require LSPClient so
  // vscode-jsonrpc (~129KB) only loads when an LSP server is actually
  // instantiated, not when the static import chain reaches this module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createLSPClient } = require('./LSPClient.js') as {
    createLSPClient: typeof createLSPClientType
  }
  let state: LspServerState = 'stopped'
  let startTime: Date | undefined
  let lastError: Error | undefined
  let restartCount = 0
  let crashRecoveryCount = 0
// 【第 118-125 行】`onCrash` 回调里写 `state = 'error'`，注释说否则是「僵尸状态」
//
// *Without this, state stays 'running' after crash and the server is never restarted (zombie state).*
//
// 把这条链路捋清楚：
// 1. 子进程崩了 → `LSPClient` 的 `exit` 监听触发 → 调 `onCrash`
// 2. `onCrash` 把本实例的 `state` 改成 `'error'`、记下 `lastError`、`crashRecoveryCount++`
// 3. 下一次 `ensureServerStarted()` 看到 `state === 'error'` → 调 `start()` 重启
//
// 如果第 2 步没写，`state` 还停在 `'running'`：
// `ensureServerStarted` 认为「已经在跑，不用启」，
// `sendRequest` 会在一个已经死掉的连接上发请求然后超时 —— 而且**永远不自愈**。
//
// 关键词是「**谁负责把外部事件翻译成内部状态**」。
// 子进程退出是外部事件，JSON-RPC 连接是外部资源；
// 本模块的状态机只有在收到通知时才会变，所以这个回调不是可选的补充，是状态机的一条输入边。
  // Propagate crash state so ensureServerStarted can restart on next use.
  // Without this, state stays 'running' after crash and the server is never
  // restarted (zombie state).
  const client = createLSPClient(name, error => {
    state = 'error'
    lastError = error
    crashRecoveryCount++
  })

  /**
   * Starts the LSP server and initializes it with workspace information.
   *
   * If the server is already running or starting, this method returns immediately.
   * On failure, sets state to 'error', logs for monitoring, and throws.
   *
   * @throws {Error} If server fails to start or initialize
   */
  async function start(): Promise<void> {
    if (state === 'running' || state === 'starting') {
      return
    }

// 【第 140-150 行】崩溃恢复次数上限，防的是「每来一个请求就 spawn 一个进程」
//
// `crashRecoveryCount` 只统计**崩溃**（回调里 ++），
// `restart()` 里清零（成功启动后 `crashRecoveryCount = 0`）。
//
// 没有这个上限会怎样：配置写错（比如 `command` 指向一个立刻退出的程序）
// → 每次 `ensureServerStarted` 都 `start()` → 起一个进程 → 它立刻崩 → `onCrash` →
// 下一次请求再来一遍。用户看到的是「Claude Code 突然很卡」，
// 实际是每秒在 fork 一个必然死掉的进程。
//
// 上限存在之后，超过就直接抛错并且**不再尝试**（注意是 `throw` 而不是 `return`）：
// 失败要显式暴露，否则又回到「安静地重试到天荒地老」。
//
// 注意 `maxRestarts` 同时被 `restart()` 和这里读 —— 但它俩用的是**不同的计数器**：
// `restartCount` 数的是「人主动重启了几次」，`crashRecoveryCount` 数的是「自己崩了几次」。
// 两个语义混成一个计数器会互相污染（手动重启会把崩溃额度用掉）。
    // Cap crash-recovery attempts so a persistently crashing server doesn't
    // spawn unbounded child processes on every incoming request.
    const maxRestarts = config.maxRestarts ?? 3
    if (state === 'error' && crashRecoveryCount > maxRestarts) {
      const error = new Error(
        `LSP server '${name}' exceeded max crash recovery attempts (${maxRestarts})`,
      )
      lastError = error
      logError(error)
      throw error
    }

    let initPromise: Promise<unknown> | undefined
    try {
      state = 'starting'
      logForDebugging(`Starting LSP server instance: ${name}`)

      // Start the client
      await client.start(config.command, config.args || [], {
        env: config.env,
        cwd: config.workspaceFolder,
      })

      // Initialize with workspace info
      const workspaceFolder = config.workspaceFolder || getCwd()
      const workspaceUri = pathToFileURL(workspaceFolder).href

// 【第 167-237 行】`InitializeParams` 里每一行注释都在讲一个兼容性妥协
//
// 这段话值得逐条看，因为它是「怎么跟一堆第三方实现对接」的实录：
//
// - `processId: process.pid` —— 让 server 能监控父进程存活，父进程死了它自己退。
// - `initializationOptions: config.initializationOptions ?? {}` —— 注释说
//   vue-language-server **必须**有这个字段，其它是可选的；所以默认给 `{}` 而不是 `undefined`。
//   「可选字段的默认值应该是空对象而不是 undefined」是踩出来的。
// - `workspaceFolders`（LSP 3.16+ 现代写法）+ `rootPath` / `rootUri`（3.8 / 3.16 已废弃）。
//   注释直说：*Deprecated fields - some servers still need these for proper URI resolution*，
//   其中 `rootUri` 是 typescript-language-server 的 `goToDefinition` 需要的。
//   **同时发新旧字段**是兼容期的标准做法，代价是两处逻辑要保持一致。
// - `capabilities` 里大量 `dynamicRegistration: false`：明确说「我不支持动态注册」，
//   这样守规矩的 server 就不会在运行期发 `client/registerCapability` 来找你。
      const initParams: InitializeParams = {
        processId: process.pid,

        // Pass server-specific initialization options from plugin config
        // Required by vue-language-server, optional for others
        // Provide empty object as default to avoid undefined errors in servers
        // that expect this field to exist
        initializationOptions: config.initializationOptions ?? {},

        // Modern approach (LSP 3.16+) - required for Pyright, gopls
        workspaceFolders: [
          {
            uri: workspaceUri,
            name: path.basename(workspaceFolder),
          },
        ],

        // Deprecated fields - some servers still need these for proper URI resolution
        rootPath: workspaceFolder, // Deprecated in LSP 3.8 but needed by some servers
        rootUri: workspaceUri, // Deprecated in LSP 3.16 but needed by typescript-language-server for goToDefinition

        // Client capabilities - declare what features we support
// 【第 188-197 行】能力声明的策略：**不声明的能力，别人就不会要求你实现**
//
// `workspace.configuration: false` 和 `workspaceFolders: false` 都是刻意的「我不支持」。
//
// LSP 的能力协商是**双向**的：客户端声明支持什么，server 才会用那些特性。
// 所以能力表不只是「说明书」，它是**一份免责声明**：
// 写 `false` 的地方，将来收到相关请求就是对方不守规矩（见
// `LSPServerManager.ts` 里给 `workspace/configuration` 兜底的那段）。
//
// 反过来说，能力表里写 `true` 就是在承诺「我会处理」，写多了等于给自己挖坑。
// 这份代码整体的取向是**窄**：只声明真的实现了的（hover / definition / references /
// documentSymbol / callHierarchy / publishDiagnostics），其余一律 `false`。
        capabilities: {
          workspace: {
            // Don't claim to support workspace/configuration since we don't implement it
            // This prevents servers from requesting config we can't provide
            configuration: false,
            // Don't claim to support workspace folders changes since we don't handle
            // workspace/didChangeWorkspaceFolders notifications
            workspaceFolders: false,
          },
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: true,
            },
            publishDiagnostics: {
              relatedInformation: true,
              tagSupport: {
                valueSet: [1, 2], // Unnecessary (1), Deprecated (2)
              },
              versionSupport: false,
              codeDescriptionSupport: true,
              dataSupport: false,
            },
            hover: {
              dynamicRegistration: false,
              contentFormat: ['markdown', 'plaintext'],
            },
            definition: {
              dynamicRegistration: false,
              linkSupport: true,
            },
            references: {
              dynamicRegistration: false,
            },
            documentSymbol: {
              dynamicRegistration: false,
              hierarchicalDocumentSymbolSupport: true,
            },
            callHierarchy: {
              dynamicRegistration: false,
            },
          },
          general: {
            positionEncodings: ['utf-16'],
          },
        },
      }

      initPromise = client.initialize(initParams)
// 【第 240-248 行】`startupTimeout` 可选，但**必须有**超时能力
//
// `config.startupTimeout !== undefined` 才包 `withTimeout`，
// 说明默认是「不超时」—— 这看起来危险，但对本地语言服务器是合理的：
// 首次启动真的可能很慢（rust-analyzer 要建索引，Go 要编译缓存），
// 给一个固定的默认值反而会误杀。
//
// 不过 `catch` 里做了两件必须做的事：
// - `client.stop().catch(() => {})` —— 超时之后那个子进程还活着，必须杀掉，否则泄漏；
// - `initPromise?.catch(() => {})` —— 被 `Promise.race` 抛下的那个 initialize promise
//   仍在跑，如果它事后 reject 而没人接，Node 会报 unhandled rejection 并可能崩进程。
//   **「放弃等待」不等于「它不会回来」**，这一行就是在处理归来的幽灵。
      if (config.startupTimeout !== undefined) {
        await withTimeout(
          initPromise,
          config.startupTimeout,
          `LSP server '${name}' timed out after ${config.startupTimeout}ms during initialization`,
        )
      } else {
        await initPromise
      }

      state = 'running'
      startTime = new Date()
      crashRecoveryCount = 0
      logForDebugging(`LSP server instance started: ${name}`)
    } catch (error) {
      // Clean up the spawned child process on timeout/error
      client.stop().catch(() => {})
      // Prevent unhandled rejection from abandoned initialize promise
      initPromise?.catch(() => {})
      state = 'error'
      lastError = error as Error
      logError(error)
      throw error
    }
  }

  /**
   * Stops the LSP server gracefully.
   *
   * If already stopped or stopping, returns immediately.
   * On failure, sets state to 'error', logs for monitoring, and throws.
   *
   * @throws {Error} If server fails to stop
   */
  async function stop(): Promise<void> {
    if (state === 'stopped' || state === 'stopping') {
      return
    }

    try {
      state = 'stopping'
      await client.stop()
      state = 'stopped'
      logForDebugging(`LSP server instance stopped: ${name}`)
    } catch (error) {
      state = 'error'
      lastError = error as Error
      logError(error)
      throw error
    }
  }

  /**
   * Manually restarts the server by stopping and starting it.
   *
   * Increments restartCount and enforces maxRestarts limit.
   * Note: This is NOT automatic - must be called explicitly.
   *
   * @throws {Error} If stop or start fails, or if restartCount exceeds config.maxRestarts (default: 3)
   */
  async function restart(): Promise<void> {
    try {
      await stop()
    } catch (error) {
      const stopError = new Error(
        `Failed to stop LSP server '${name}' during restart: ${errorMessage(error)}`,
      )
      logError(stopError)
      throw stopError
    }

    restartCount++

    const maxRestarts = config.maxRestarts ?? 3
    if (restartCount > maxRestarts) {
      const error = new Error(
        `Max restart attempts (${maxRestarts}) exceeded for server '${name}'`,
      )
      logError(error)
      throw error
    }

    try {
      await start()
    } catch (error) {
      const startError = new Error(
        `Failed to start LSP server '${name}' during restart (attempt ${restartCount}/${maxRestarts}): ${errorMessage(error)}`,
      )
      logError(startError)
      throw startError
    }
  }

  /**
   * Checks if the server is healthy and ready to handle requests.
   *
   * @returns true if state is 'running' AND the client has completed initialization
   */
// 【第 338-340 行】`isHealthy()` 要求**两个**条件：状态机说 running、且协议说 initialized
//
// `state === 'running' && client.isInitialized`
//
// 两个条件对应两个视角：
// - `state` 是**本实例的**状态机（`stopped → starting → running`），由本文件的代码维护；
// - `isInitialized` 是**协议层**的事实，只有 `initialize()` 收到响应、并发出
//   `initialized` 通知之后才为 true（见 `LSPClient.initialize`）。
//
// 为什么不能只看 `state === 'running'`：`start()` 里 `state = 'running'` 的赋值
// 发生在 `await client.initialize(...)` **之后**，所以理论上两者同步。
// 但崩溃恢复、重连这些路径下它们可能短暂不一致，而「在没初始化完的连接上发请求」
// 会得到 `-32002 ServerNotInitialized`，是个纯粹可以避免的错误。
//
// `isHealthy` 的用法是**发送前的门禁**（`sendRequest` / `sendNotification` 第一行），
// 所以它就该是最严格的那个判据。
  function isHealthy(): boolean {
    return state === 'running' && client.isInitialized
  }

  /**
   * Sends an LSP request to the server with retry logic for transient errors.
   *
   * Checks server health before sending and wraps errors with context.
   * Automatically retries on "content modified" errors (code -32801) which occur
   * when servers like rust-analyzer are still indexing. This is expected LSP behavior
   * and clients should retry silently per the LSP specification.
   *
   * @param method - LSP method name (e.g., 'textDocument/definition')
   * @param params - Method-specific parameters
   * @returns The server's response
   * @throws {Error} If server is not healthy or request fails after all retries
   */
  async function sendRequest<T>(method: string, params: unknown): Promise<T> {
    if (!isHealthy()) {
      const error = new Error(
        `Cannot send request to LSP server '${name}': server is ${state}` +
          `${lastError ? `, last error: ${lastError.message}` : ''}`,
      )
      logError(error)
      throw error
    }

    let lastAttemptError: Error | undefined

    for (
      let attempt = 0;
      attempt <= MAX_RETRIES_FOR_TRANSIENT_ERRORS;
      attempt++
    ) {
      try {
        return await client.sendRequest(method, params)
      } catch (error) {
        lastAttemptError = error as Error

        // Check if this is a transient "content modified" error that we should retry
        // This commonly happens with rust-analyzer during initial project indexing.
        // We use duck typing instead of instanceof because there may be multiple
        // versions of vscode-jsonrpc in the dependency tree (8.2.0 vs 8.2.1).
        const errorCode = (error as { code?: number }).code
// 【第 381-388 行】用 duck typing 判错误码，因为依赖树里有**两个版本**的 vscode-jsonrpc
//
// 注释：*We use duck typing instead of `instanceof` because there may be multiple
// versions of vscode-jsonrpc in the dependency tree (8.2.0 vs 8.2.1).*
//
// `instanceof ResponseError` 在**单实例**的世界里是最干净的判据，
// 但一旦同一个类被打包了两份，两份的 `prototype` 不是同一个对象，
// `instanceof` 对「来自另一份的错误对象」恒为 false。
//
// 所以这里只读一个字段：`(error as { code?: number }).code`。
// `code` 是 JSON-RPC 线上传输的实际字段，任何版本的实现都会带上它 ——
// **线上协议比类继承关系稳定**。
//
// 这是「跨版本兼容时，判据要选协议字段而不是类型身份」的实例。
// 代价是类型系统帮不上忙（`as` 就是在说「我知道我在绕过检查」）。
        const isContentModifiedError =
          typeof errorCode === 'number' &&
          errorCode === LSP_ERROR_CONTENT_MODIFIED

        if (
          isContentModifiedError &&
          attempt < MAX_RETRIES_FOR_TRANSIENT_ERRORS
        ) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
          logForDebugging(
            `LSP request '${method}' to '${name}' got ContentModified error, ` +
              `retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES_FOR_TRANSIENT_ERRORS})…`,
          )
          await sleep(delay)
          continue
        }

        // Non-retryable error or max retries exceeded
        break
      }
    }

    // All retries failed or non-retryable error
    const requestError = new Error(
      `LSP request '${method}' failed for server '${name}': ${lastAttemptError?.message ?? 'unknown error'}`,
    )
    logError(requestError)
    throw requestError
  }

  /**
   * Send a notification to the LSP server (fire-and-forget).
   * Used for file synchronization (didOpen, didChange, didClose).
   */
  async function sendNotification(
    method: string,
    params: unknown,
  ): Promise<void> {
    if (!isHealthy()) {
      const error = new Error(
        `Cannot send notification to LSP server '${name}': server is ${state}`,
      )
      logError(error)
      throw error
    }

    try {
      await client.sendNotification(method, params)
    } catch (error) {
      const notificationError = new Error(
        `LSP notification '${method}' failed for server '${name}': ${errorMessage(error)}`,
      )
      logError(notificationError)
      throw notificationError
    }
  }

  /**
   * Registers a handler for LSP notifications from the server.
   *
   * @param method - LSP notification method (e.g., 'window/logMessage')
   * @param handler - Callback function to handle the notification
   */
  function onNotification(
    method: string,
    handler: (params: unknown) => void,
  ): void {
    client.onNotification(method, handler)
  }

  /**
   * Registers a handler for LSP requests from the server.
   *
   * Some LSP servers send requests TO the client (reverse direction).
   * This allows registering handlers for such requests.
   *
   * @param method - LSP request method (e.g., 'workspace/configuration')
   * @param handler - Callback function to handle the request and return a response
   */
  function onRequest<TParams, TResult>(
    method: string,
    handler: (params: TParams) => TResult | Promise<TResult>,
  ): void {
    client.onRequest(method, handler)
  }

  // Return public API
  return {
    name,
    config,
    get state() {
      return state
    },
    get startTime() {
      return startTime
    },
    get lastError() {
      return lastError
    },
    get restartCount() {
      return restartCount
    },
    start,
    stop,
    restart,
    isHealthy,
    sendRequest,
    sendNotification,
    onNotification,
    onRequest,
  }
}

// 【第 495-511 行】`withTimeout` 的两个细节
//
// 1. `setTimeout(fn, ms, arg1, arg2)` 这种三参数以上形式，把参数直接传给回调，
//    省掉一层闭包。这里传的是 `reject` 和 `message`，
//    所以定时器触发时执行的是 `reject(new Error(message))`。
// 2. `.finally(() => clearTimeout(timer!))` —— **无论谁赢都要清计时器**。
//
// 第 2 点为什么重要：如果 promise 先完成，那个 `setTimeout` 仍然会在 3 秒后触发，
// 对着一个已经 resolve 的 promise 调 `reject`（无害），但计时器本身会**让事件循环
// 多活 3 秒**。在 Node 里这就是「进程已经该退出了却卡着不退」的经典原因。
//
// `timer!` 的非空断言是必要的：TypeScript 看不出 `Promise` 构造器里的同步执行，
// 认为 `timer` 可能还没赋值。实际执行顺序保证它一定赋过了。
//
// 顺带一个命名点：`Promise.race([promise, timeoutPromise])` 里
// `timeoutPromise` 永远不会 resolve，只能 reject —— 它唯一的作用是「到点就炸」。
/**
 * Race a promise against a timeout. Cleans up the timer regardless of outcome
 * to avoid unhandled rejections from orphaned setTimeout callbacks.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout((rej, msg) => rej(new Error(msg)), ms, reject, message)
  })
  return Promise.race([promise, timeoutPromise]).finally(() =>
    clearTimeout(timer!),
  )
}
