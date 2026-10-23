import { useEffect, useRef } from 'react'
import { logError } from 'src/utils/log.js'
import { z } from 'zod/v4'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
} from '../services/mcp/types.js'
import { getConnectedIdeClient } from '../utils/ide.js'
import { lazySchema } from '../utils/lazySchema.js'
export type IDEAtMentioned = {
  filePath: string
  lineStart?: number
  lineEnd?: number
}

const NOTIFICATION_METHOD = 'at_mentioned'
// 通知方法名常量，MCP 客户端用 method 字段路由通知类型，写死避免拼写漂移。

const AtMentionedSchema = lazySchema(() =>
  z.object({
    method: z.literal(NOTIFICATION_METHOD),
    params: z.object({
      filePath: z.string(),
      lineStart: z.number().optional(),
      lineEnd: z.number().optional(),
    }),
  }),
)

/**
 * A hook that tracks IDE at-mention notifications by directly registering
 * with MCP client notification handlers,
 */
// 本文件只做一件事：直接往 IDE 的 MCP client 注册 at_mentioned 通知处理器，
// 不走 React state，靠 ref 持有当前 client 做闭包守卫（与 useIdeSelection 同套路）。
export function useIdeAtMentioned(
  mcpClients: MCPServerConnection[],
  onAtMentioned: (atMentioned: IDEAtMentioned) => void,
): void {
  const ideClientRef = useRef<ConnectedMCPServer | undefined>(undefined)
// ideClientRef 只存「当前连接上的 IDE client」；下面 handler 里会再用它判旧 client 是否已失效。

  useEffect(() => {
    // Find the IDE client from the MCP clients list
    const ideClient = getConnectedIdeClient(mcpClients)

    if (ideClientRef.current !== ideClient) {
      ideClientRef.current = ideClient
    }

    // If we found a connected IDE client, register our handler
    if (ideClient) {
      ideClient.client.setNotificationHandler(
        AtMentionedSchema(),
        notification => {
          if (ideClientRef.current !== ideClient) {
// 闭包守卫：MCP client 列表变化导致 ideClient 被换掉时，旧 client 的回调必须丢弃，
// 否则会把一个已断开会话的 @ 提及误投到新会话。
            return
          }
          try {
            const data = notification.params
            // Adjust line numbers to be 1-based instead of 0-based
// MCP 协议里行号是 0-based，UI 侧约定 1-based，这里统一 +1 对齐。
            const lineStart =
              data.lineStart !== undefined ? data.lineStart + 1 : undefined
            const lineEnd =
              data.lineEnd !== undefined ? data.lineEnd + 1 : undefined
            onAtMentioned({
              filePath: data.filePath,
              lineStart: lineStart,
              lineEnd: lineEnd,
            })
          } catch (error) {
            logError(error as Error)
          }
        },
      )
    }

    // No cleanup needed as MCP clients manage their own lifecycle
// 不写 cleanup：MCP client 自己管理连接生命周期，hook 卸载时连接未必断。
  }, [mcpClients, onAtMentioned])
}
