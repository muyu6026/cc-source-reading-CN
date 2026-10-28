import {
  type ClaudeForChromeContext,
  createClaudeForChromeMcpServer,
  type Logger,
  type PermissionMode,
} from '@ant/claude-for-chrome-mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { format } from 'util'
import { shutdownDatadog } from '../../services/analytics/datadog.js'
import { shutdown1PEventLogging } from '../../services/analytics/firstPartyEventLogger.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { initializeAnalyticsSink } from '../../services/analytics/sink.js'
import { getClaudeAIOAuthTokens } from '../auth.js'
import { enableConfigs, getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { sideQuery } from '../sideQuery.js'
import { getAllSocketPaths, getSecureSocketPath } from './common.js'

const EXTENSION_DOWNLOAD_URL = 'https://claude.ai/chrome'
const BUG_REPORT_URL =
  'https://github.com/anthropics/claude-code/issues/new?labels=bug,claude-in-chrome'

// String metadata keys safe to forward to analytics. Keys like error_message
// are excluded because they could contain page content or user data.
const SAFE_BRIDGE_STRING_KEYS = new Set([
// SAFE_BRIDGE_STRING_KEYS：允许转发给分析系统的字符串键白名单，像 error_message 这类可能含页面内容的键被排除。
  'bridge_status',
  'error_type',
  'tool_name',
])

const PERMISSION_MODES: readonly PermissionMode[] = [
// PERMISSION_MODES：浏览器扩展侧支持的权限模式常量集合，用于校验运行时传入的模式值。
  'ask',
  'skip_all_permission_checks',
  'follow_a_plan',
]

// isPermissionMode：类型守卫，判断原始字符串是否为合法的权限模式。
function isPermissionMode(raw: string): raw is PermissionMode {
  return PERMISSION_MODES.some(m => m === raw)
}

/**
 * Resolves the Chrome bridge URL based on environment and feature flag.
 * Bridge is used when the feature flag is enabled; ant users always get
 * bridge. API key / 3P users fall back to native messaging.
 */
// getChromeBridgeUrl：根据环境变量与特性开关解析 Chrome 桥接地址，ant 用户或开启开关时走桥接，否则回退原生消息。
function getChromeBridgeUrl(): string | undefined {
  const bridgeEnabled =
    process.env.USER_TYPE === 'ant' ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_copper_bridge', false)

  if (!bridgeEnabled) {
    return undefined
  }

  if (
    isEnvTruthy(process.env.USE_LOCAL_OAUTH) ||
    isEnvTruthy(process.env.LOCAL_BRIDGE)
  ) {
    return 'ws://localhost:8765'
  }

  if (isEnvTruthy(process.env.USE_STAGING_OAUTH)) {
    return 'wss://bridge-staging.claudeusercontent.com'
  }

  return 'wss://bridge.claudeusercontent.com'
}

// isLocalBridge：判断当前是否使用本地桥接（本地 OAuth 或本地桥接环境变量）。
function isLocalBridge(): boolean {
  return (
    isEnvTruthy(process.env.USE_LOCAL_OAUTH) ||
    isEnvTruthy(process.env.LOCAL_BRIDGE)
  )
}

/**
 * Build the ClaudeForChromeContext used by both the subprocess MCP server
 * and the in-process path in the MCP client.
 */
// createChromeContext：构建 ClaudeForChrome 上下文，供子进程 MCP 服务端与进程内客户端共用。
export function createChromeContext(
  env?: Record<string, string>,
): ClaudeForChromeContext {
  const logger = new DebugLogger()
  const chromeBridgeUrl = getChromeBridgeUrl()
  logger.info(`Bridge URL: ${chromeBridgeUrl ?? 'none (using native socket)'}`)
  const rawPermissionMode =
    env?.CLAUDE_CHROME_PERMISSION_MODE ??
    process.env.CLAUDE_CHROME_PERMISSION_MODE
  let initialPermissionMode: PermissionMode | undefined
  if (rawPermissionMode) {
    if (isPermissionMode(rawPermissionMode)) {
      initialPermissionMode = rawPermissionMode
    } else {
      logger.warn(
        `Invalid CLAUDE_CHROME_PERMISSION_MODE "${rawPermissionMode}". Valid values: ${PERMISSION_MODES.join(', ')}`,
      )
    }
  }
  return {
    serverName: 'Claude in Chrome',
    logger,
    socketPath: getSecureSocketPath(),
    getSocketPaths: getAllSocketPaths,
    clientTypeId: 'claude-code',
    onAuthenticationError: () => {
// onAuthenticationError：鉴权失败时提示用户用同一 claude.ai 账号登录浏览器扩展。
      logger.warn(
        'Authentication error occurred. Please ensure you are logged into the Claude browser extension with the same claude.ai account as Claude Code.',
      )
    },
    onToolCallDisconnected: () => {
      return `Browser extension is not connected. Please ensure the Claude browser extension is installed and running (${EXTENSION_DOWNLOAD_URL}), and that you are logged into claude.ai with the same account as Claude Code. If this is your first time connecting to Chrome, you may need to restart Chrome for the installation to take effect. If you continue to experience issues, please report a bug: ${BUG_REPORT_URL}`
    },
    onExtensionPaired: (deviceId: string, name: string) => {
      saveGlobalConfig(config => {
        if (
          config.chromeExtension?.pairedDeviceId === deviceId &&
          config.chromeExtension?.pairedDeviceName === name
        ) {
          return config
        }
        return {
          ...config,
          chromeExtension: {
            pairedDeviceId: deviceId,
            pairedDeviceName: name,
          },
        }
      })
      logger.info(`Paired with "${name}" (${deviceId.slice(0, 8)})`)
    },
    getPersistedDeviceId: () => {
      return getGlobalConfig().chromeExtension?.pairedDeviceId
    },
    ...(chromeBridgeUrl && {
      bridgeConfig: {
        url: chromeBridgeUrl,
        getUserId: async () => {
          return getGlobalConfig().oauthAccount?.accountUuid
        },
        getOAuthToken: async () => {
          return getClaudeAIOAuthTokens()?.accessToken ?? ''
        },
        ...(isLocalBridge() && { devUserId: 'dev_user_local' }),
      },
    }),
    ...(initialPermissionMode && { initialPermissionMode }),
    // Wire inference for the browser_task tool — the chrome-mcp server runs
    // a lightning-mode agent loop in Node and calls the extension's
    // lightning_turn tool once per iteration for execution.
    //
    // Ant-only: the extension's lightning_turn is build-time-gated via
    // import.meta.env.ANT_ONLY_BUILD — the whole lightning/ module graph is
    // tree-shaken from the public extension build (build:prod greps for a
    // marker to verify). Without this injection, the Node MCP server's
    // ListTools also filters browser_task + lightning_turn out, so external
    // users never see the tools advertised. Three independent gates.
    //
    // Types inlined: AnthropicMessagesRequest/Response live in
    // @ant/claude-for-chrome-mcp@0.4.0 which isn't published yet. CI installs
    // 0.3.0. The callAnthropicMessages field is also 0.4.0-only, but spreading
    // an extra property into ClaudeForChromeContext is fine against either
    // version — 0.3.0 sees an unknown field (allowed in spread), 0.4.0 sees a
    // structurally-matching one. Once 0.4.0 is published, this can switch to
    // the package's exported types and the dep can be bumped.
    ...(process.env.USER_TYPE === 'ant' && {
      callAnthropicMessages: async (req: {
        model: string
        max_tokens: number
        system: string
        messages: Parameters<typeof sideQuery>[0]['messages']
        stop_sequences?: string[]
        signal?: AbortSignal
      }): Promise<{
        content: Array<{ type: 'text'; text: string }>
        stop_reason: string | null
        usage?: { input_tokens: number; output_tokens: number }
      }> => {
        // sideQuery handles OAuth attribution fingerprint, proxy, model betas.
        // skipSystemPromptPrefix: the lightning prompt is complete on its own;
        // the CLI prefix would dilute the batching instructions.
        // tools: [] is load-bearing — without it Sonnet emits
        // <function_calls> XML before the text commands. Original
        // lightning-harness.js (apps repo) does the same.
        const response = await sideQuery({
          model: req.model,
          system: req.system,
          messages: req.messages,
          max_tokens: req.max_tokens,
          stop_sequences: req.stop_sequences,
          signal: req.signal,
          skipSystemPromptPrefix: true,
          tools: [],
          querySource: 'chrome_mcp',
        })
        // BetaContentBlock is TextBlock | ThinkingBlock | ToolUseBlock | ...
        // Only text blocks carry the model's command output.
        const textBlocks: Array<{ type: 'text'; text: string }> = []
        for (const b of response.content) {
          if (b.type === 'text') {
            textBlocks.push({ type: 'text', text: b.text })
          }
        }
        return {
          content: textBlocks,
          stop_reason: response.stop_reason,
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
          },
        }
      },
    }),
    trackEvent: (eventName, metadata) => {
// trackEvent：把事件转发给分析系统，仅放行白名单字符串键并把 status 改名为 bridge_status 以避开保留字段。
      const safeMetadata: {
        [key: string]:
          | boolean
          | number
          | AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          | undefined
      } = {}
      if (metadata) {
        for (const [key, value] of Object.entries(metadata)) {
          // Rename 'status' to 'bridge_status' to avoid Datadog's reserved field
          const safeKey = key === 'status' ? 'bridge_status' : key
          if (typeof value === 'boolean' || typeof value === 'number') {
            safeMetadata[safeKey] = value
          } else if (
            typeof value === 'string' &&
            SAFE_BRIDGE_STRING_KEYS.has(safeKey)
          ) {
            // Only forward allowlisted string keys — fields like error_message
            // could contain page content or user data
            safeMetadata[safeKey] =
              value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          }
        }
      }
      logEvent(eventName, safeMetadata)
    },
  }
}

// runClaudeInChromeMcpServer：启动 ClaudeInChrome 的 MCP 服务端，父进程退出时先冲刷分析数据再退出。
export async function runClaudeInChromeMcpServer(): Promise<void> {
  enableConfigs()
  initializeAnalyticsSink()
  const context = createChromeContext()

  const server = createClaudeForChromeMcpServer(context)
  const transport = new StdioServerTransport()

  // Exit when parent process dies (stdin pipe closes).
  // Flush analytics before exiting so final-batch events (e.g. disconnect) aren't lost.
  let exiting = false
  const shutdownAndExit = async (): Promise<void> => {
    if (exiting) {
      return
    }
    exiting = true
    await shutdown1PEventLogging()
    await shutdownDatadog()
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0)
  }
  process.stdin.on('end', () => void shutdownAndExit())
  process.stdin.on('error', () => void shutdownAndExit())

  logForDebugging('[Claude in Chrome] Starting MCP server')
  await server.connect(transport)
  logForDebugging('[Claude in Chrome] MCP server started')
}

// DebugLogger：把 MCP 服务端的日志级别映射到本地调试日志输出。
class DebugLogger implements Logger {
  silly(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'debug' })
  }
  debug(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'debug' })
  }
  info(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'info' })
  }
  warn(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'warn' })
  }
  error(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'error' })
  }
}
