import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { checkHasTrustDialogAccepted } from '../../utils/config.js'
import { logAntError } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { logError, logMCPDebug, logMCPError } from '../../utils/log.js'
import { jsonParse } from '../../utils/slowOperations.js'
import { logEvent } from '../analytics/index.js'
import type {
  McpHTTPServerConfig,
  McpSSEServerConfig,
  McpWebSocketServerConfig,
  ScopedMcpServerConfig,
} from './types.js'

/**
 * Check if the MCP server config comes from project settings (projectSettings or localSettings)
 * This is important for security checks
 */
function isMcpServerFromProjectOrLocalSettings(
  config: ScopedMcpServerConfig,
): boolean {
  return config.scope === 'project' || config.scope === 'local'
}
// 这个判断是整份文件的安全边界起点：project 作用域的配置来自仓库里的
// .mcp.json —— 别人提交的文件、被投毒的 PR 都能写。
//
// 于是「在用户机器上跑一条命令」这件事，必须排在「用户点过信任这个目录」之后。
// 下面那个 trust 检查不是防御性代码，是这条链上唯一的闸。

/**
 * Get dynamic headers for an MCP server using the headersHelper script
 * @param serverName The name of the MCP server
 * @param config The MCP server configuration
 * @returns Headers object or null if not configured or failed
 */
export async function getMcpHeadersFromHelper(
  serverName: string,
  config: McpSSEServerConfig | McpHTTPServerConfig | McpWebSocketServerConfig,
): Promise<Record<string, string> | null> {
  if (!config.headersHelper) {
    return null
  }

  // Security check for project/local settings
  // Skip trust check in non-interactive mode (e.g., CI/CD, automation)
  if (
    'scope' in config &&
    isMcpServerFromProjectOrLocalSettings(config as ScopedMcpServerConfig) &&
    !getIsNonInteractiveSession()
  ) {
// 非交互模式下跳过这道检查：CI 里没有对话框可点，卡在这里等于永挂。
//
// 代价要说明白：SDK / -p 场景下这条防线**不存在**，安全责任转移到
// 「别在不可信目录里跑 -p」这条使用约定上。这类「为了可用性让掉一段安全」
// 的决定，注释里通常只写做法，不写代价 —— 代价才是需要读者自己补上的部分。
    // Check if trust has been established for this project
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust) {
      const error = new Error(
        `Security: headersHelper for MCP server '${serverName}' executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('MCP headersHelper invoked before trust check', error)
      logEvent('tengu_mcp_headersHelper_missing_trust', {})
      return null
    }
  }

  try {
    logMCPDebug(serverName, 'Executing headersHelper to get dynamic headers')
    const execResult = await execFileNoThrowWithCwd(config.headersHelper, [], {
      shell: true,
      timeout: 10000,
      // Pass server context so one helper script can serve multiple MCP servers
      // (git credential-helper style). See deshaw/anthropic-issues#28.
      env: {
        ...process.env,
        CLAUDE_CODE_MCP_SERVER_NAME: serverName,
        CLAUDE_CODE_MCP_SERVER_URL: config.url,
      },
    })
// 一行里三个决定：
//
//   shell: true —— headersHelper 是一整条 shell 命令，不是「可执行文件 + 参数」。
//     它能跑管道、能取命令替换。这也意味着这个配置字段等于「任意命令执行权」，
//     上面那道信任检查是它唯一的限制。
//
//   timeout 10000 —— 没有超时的话，一个卡住的 helper 会把 MCP 连接卡到天荒地老，
//     而症状是「这个 server 一直连不上」，看不出是被 helper 拖住的。
//
//   env 里塞 server 名和 URL —— git credential-helper 那套思路：一个脚本服务
//     多个 server，按 CLAUDE_CODE_MCP_SERVER_NAME 分支。这也是 helper 必须能拿到
//     配置里其他信息（URL）的原因。
    if (execResult.code !== 0 || !execResult.stdout) {
      throw new Error(
        `headersHelper for MCP server '${serverName}' did not return a valid value`,
      )
    }
    const result = execResult.stdout.trim()

    const headers = jsonParse(result)
    if (
      typeof headers !== 'object' ||
      headers === null ||
      Array.isArray(headers)
    ) {
      throw new Error(
        `headersHelper for MCP server '${serverName}' must return a JSON object with string key-value pairs`,
      )
    }

    // Validate all values are strings
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== 'string') {
        throw new Error(
          `headersHelper for MCP server '${serverName}' returned non-string value for key "${key}": ${typeof value}`,
        )
      }
    }

    logMCPDebug(
      serverName,
      `Successfully retrieved ${Object.keys(headers).length} headers from headersHelper`,
    )
    return headers as Record<string, string>
  } catch (error) {
    logMCPError(
      serverName,
      `Error getting headers from headersHelper: ${errorMessage(error)}`,
    )
    logError(
      new Error(
        `Error getting MCP headers from headersHelper for server '${serverName}': ${errorMessage(error)}`,
      ),
    )
    // Return null instead of throwing to avoid blocking the connection
// 失败返回 null 而不是 throw：一个 helper 挂了不该让整个 MCP 连接失败，
// 调用方会退化成「只有静态 headers」。
//
// 代价是诊断变难：「helper 一直失败」在 UI 上表现为「认证莫名失效」，
// 只有 MCP 日志里能看到真正原因。所以这里同时写了 logMCPError 和 logError 两条 ——
// 一条给用户看的通道，一条给开发者看的通道。
    return null
  }
}

/**
 * Get combined headers for an MCP server (static + dynamic)
 * @param serverName The name of the MCP server
 * @param config The MCP server configuration
 * @returns Combined headers object
 */
export async function getMcpServerHeaders(
  serverName: string,
  config: McpSSEServerConfig | McpHTTPServerConfig | McpWebSocketServerConfig,
): Promise<Record<string, string>> {
  const staticHeaders = config.headers || {}
  const dynamicHeaders =
    (await getMcpHeadersFromHelper(serverName, config)) || {}

  // Dynamic headers override static headers if both are present
  return {
    ...staticHeaders,
    ...dynamicHeaders,
  }
}
