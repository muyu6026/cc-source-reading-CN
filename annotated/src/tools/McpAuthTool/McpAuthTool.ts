import reject from 'lodash-es/reject.js'
import { z } from 'zod/v4'
import { performMCPOAuthFlow } from '../../services/mcp/auth.js'
import {
  clearMcpAuthCache,
  reconnectMcpServerImpl,
} from '../../services/mcp/client.js'
import {
  buildMcpToolName,
  getMcpPrefix,
} from '../../services/mcp/mcpStringUtils.js'
import type {
  McpHTTPServerConfig,
  McpSSEServerConfig,
  ScopedMcpServerConfig,
} from '../../services/mcp/types.js'
import type { Tool } from '../../Tool.js'
import { errorMessage } from '../../utils/errors.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logMCPDebug, logMCPError } from '../../utils/log.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'

const inputSchema = lazySchema(() => z.object({}))
// 输入 schema 为空对象：这个伪工具不接受任何参数——认证动作本身没有可配置项，
// 服务器身份由工厂闭包携带。
type InputSchema = ReturnType<typeof inputSchema>

export type McpAuthOutput = {
  status: 'auth_url' | 'unsupported' | 'error'
  message: string
  authUrl?: string
}
// 输出三态：auth_url（拿到授权 URL）/ unsupported（传输类型不支持 OAuth）/ error（启动失败）。
// authUrl 仅在 auth_url 且非静默认证时存在。

function getConfigUrl(config: ScopedMcpServerConfig): string | undefined {
  if ('url' in config) return config.url
  return undefined
}
// getConfigUrl：只有 url 型配置（sse/http）才有可展示的 URL；
// stdio 型没有，展示层就退化为只显示传输类型。

/**
 * Creates a pseudo-tool for an MCP server that is installed but not
 * authenticated. Surfaced in place of the server's real tools so the model
 * knows the server exists and can start the OAuth flow on the user's behalf.
 *
 * When called, starts performMCPOAuthFlow with skipBrowserOpen and returns
 * the authorization URL. The OAuth callback completes in the background;
 * once it fires, reconnectMcpServerImpl runs and the server's real tools
 * are swapped into appState.mcp.tools via the existing prefix-based
 * replacement (useManageMCPConnections.updateServer wipes anything matching
 * mcp__<server>__*, so this pseudo-tool is removed automatically).
 */
// createMcpAuthTool：为「已安装但未认证」的 MCP 服务器生成一个伪工具，
// 顶替该服务器真正的工具位。模型由此得知服务器存在，并可代用户发起 OAuth。
// 认证完成后 OAuth 回调在后台走完，reconnectMcpServerImpl 重连，
// 真实工具经 appState.mcp.tools 的前缀替换（useManageMCPConnections.updateServer
// 会清掉所有 mcp__<server>__*）换入，伪工具随之自动消失。
export function createMcpAuthTool(
  serverName: string,
  config: ScopedMcpServerConfig,
): Tool<InputSchema, McpAuthOutput> {
  const url = getConfigUrl(config)
  const transport = config.type ?? 'stdio'
  const location = url ? `${transport} at ${url}` : transport
// transport 默认 stdio；location 拼出「类型 @ URL」的人读描述，stdio 时只有类型。

  const description =
    `The \`${serverName}\` MCP server (${location}) is installed but requires authentication. ` +
    `Call this tool to start the OAuth flow — you'll receive an authorization URL to share with the user. ` +
    `Once the user completes authorization in their browser, the server's real tools will become available automatically.`

  return {
    name: buildMcpToolName(serverName, 'authenticate'),
    isMcp: true,
    mcpInfo: { serverName, toolName: 'authenticate' },
    isEnabled: () => true,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    toAutoClassifierInput: () => serverName,
    userFacingName: () => `${serverName} - authenticate (MCP)`,
// 工具名走 buildMcpToolName(serverName, 'authenticate')——与真实 MCP 工具同前缀，
// 这是认证完成后能被前缀替换机制一并清掉的关键。userFacingName 给人看。
    maxResultSizeChars: 10_000,
    renderToolUseMessage: () => `Authenticate ${serverName} MCP server`,
    async description() {
      return description
    },
    async prompt() {
      return description
    },
    get inputSchema(): InputSchema {
      return inputSchema()
    },
    async checkPermissions(input): Promise<PermissionDecision> {
      return { behavior: 'allow', updatedInput: input }
// checkPermissions 恒 allow：发起认证不需要额外审批——
// 真正的用户动作发生在浏览器里完成 OAuth，这里没有可越权的东西。
    },
    async call(_input, context) {
      // claude.ai connectors use a separate auth flow (handleClaudeAIAuth in
      // MCPRemoteServerMenu) that we don't invoke programmatically here —
      // just point the user at /mcp.
      if (config.type === 'claudeai-proxy') {
        return {
          data: {
            status: 'unsupported' as const,
            message: `This is a claude.ai MCP connector. Ask the user to run /mcp and select "${serverName}" to authenticate.`,
          },
        }
      }
// claude.ai 代理连接器走独立认证流（MCPRemoteServerMenu 的 handleClaudeAIAuth），
// 无法在此编程触发——只能指引用户跑 /mcp 手动认证。

      // performMCPOAuthFlow only accepts sse/http. needs-auth state is only
      // set on HTTP 401 (UnauthorizedError) so other transports shouldn't
      // reach here, but be defensive.
      if (config.type !== 'sse' && config.type !== 'http') {
        return {
          data: {
            status: 'unsupported' as const,
            message: `Server "${serverName}" uses ${transport} transport which does not support OAuth from this tool. Ask the user to run /mcp and authenticate manually.`,
          },
        }
      }
// performMCPOAuthFlow 只接受 sse/http。needs-auth 状态只在 HTTP 401
// （UnauthorizedError）时设置，其他传输类型按理到不了这里，但防御性兜底。

      const sseOrHttpConfig = config as (
        | McpSSEServerConfig
        | McpHTTPServerConfig
      ) & { scope: ScopedMcpServerConfig['scope'] }

      // Mirror cli/print.ts mcp_authenticate: start the flow, capture the
      // URL via onAuthorizationUrl, return it immediately. The flow's
      // Promise resolves later when the browser callback fires.
      let resolveAuthUrl: ((url: string) => void) | undefined
      const authUrlPromise = new Promise<string>(resolve => {
        resolveAuthUrl = resolve
      })
// authUrlPromise：手工构造的 Promise + resolve 句柄。
// performMCPOAuthFlow 通过 onAuthorizationUrl 回调把授权 URL 递进来，
// 工具随即返回；整个 OAuth 流的 Promise 要等浏览器回调之后才 resolve。

      const controller = new AbortController()
      const { setAppState } = context

      const oauthPromise = performMCPOAuthFlow(
        serverName,
        sseOrHttpConfig,
        u => resolveAuthUrl?.(u),
        controller.signal,
        { skipBrowserOpen: true },
      )
// skipBrowserOpen: true——工具不发浏览器，URL 交给模型转述给用户
// （模型可能在无头环境，也可能想把链接写进消息）。

      // Background continuation: once OAuth completes, reconnect and swap
      // the real tools into appState. Prefix-based replacement removes this
      // pseudo-tool since it shares the mcp__<server>__ prefix.
      void oauthPromise
// void oauthPromise.then(...)：后台续段——OAuth 完成后清认证缓存、重连服务器、
// 把真实工具/命令/资源经前缀替换写回 appState。catch 只记日志不抛出：
// 工具此刻早已返回，失败只能体现在下次工具列表刷新上。
        .then(async () => {
          clearMcpAuthCache()
          const result = await reconnectMcpServerImpl(serverName, config)
          const prefix = getMcpPrefix(serverName)
          setAppState(prev => ({
            ...prev,
            mcp: {
              ...prev.mcp,
              clients: prev.mcp.clients.map(c =>
                c.name === serverName ? result.client : c,
              ),
              tools: [
                ...reject(prev.mcp.tools, t => t.name?.startsWith(prefix)),
                ...result.tools,
              ],
              commands: [
                ...reject(prev.mcp.commands, c => c.name?.startsWith(prefix)),
                ...result.commands,
              ],
              resources: result.resources
                ? { ...prev.mcp.resources, [serverName]: result.resources }
                : prev.mcp.resources,
            },
          }))
          logMCPDebug(
            serverName,
            `OAuth complete, reconnected with ${result.tools.length} tool(s)`,
          )
        })
        .catch(err => {
          logMCPError(
            serverName,
            `OAuth flow failed after tool-triggered start: ${errorMessage(err)}`,
          )
        })
// 后台失败的兜底：logMCPError 记录，不中断主流程。

      try {
        // Race: get the URL, or the flow completes without needing one
        // (e.g. XAA with cached IdP token — silent auth).
        const authUrl = await Promise.race([
          authUrlPromise,
          oauthPromise.then(() => null as string | null),
        ])
// Promise.race 竞速：拿到 URL 就返回 URL；
// 若整个 OAuth 流先跑完（如 XAA 带 IdP 缓存令牌的静默认证）则返回 null——静默完成。

        if (authUrl) {
          return {
            data: {
              status: 'auth_url' as const,
              authUrl,
              message: `Ask the user to open this URL in their browser to authorize the ${serverName} MCP server:\n\n${authUrl}\n\nOnce they complete the flow, the server's tools will become available automatically.`,
            },
          }
        }
// 非静默路径：把授权 URL 原样交给模型，消息里明确「用户在浏览器完成后工具自动可用」。

        return {
          data: {
            status: 'auth_url' as const,
            message: `Authentication completed silently for ${serverName}. The server's tools should now be available.`,
          },
        }
// 静默路径：认证已悄然完成，告知模型服务器工具应该已经就绪。
      } catch (err) {
        return {
          data: {
            status: 'error' as const,
            message: `Failed to start OAuth flow for ${serverName}: ${errorMessage(err)}. Ask the user to run /mcp and authenticate manually.`,
          },
        }
// 启动失败：错误信息原样回传并降级指引（跑 /mcp 手动认证）。
      }
    },
    mapToolResultToToolResultBlockParam(data, toolUseID) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: data.message,
      }
    },
// 工具结果块只带 message 一段文本——模型读到的就是这个字符串。
  } satisfies Tool<InputSchema, McpAuthOutput>
}
