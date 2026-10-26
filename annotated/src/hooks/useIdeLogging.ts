import { useEffect } from 'react'
import { logEvent } from 'src/services/analytics/index.js'
import { z } from 'zod/v4'
import type { MCPServerConnection } from '../services/mcp/types.js'
import { getConnectedIdeClient } from '../utils/ide.js'
import { lazySchema } from '../utils/lazySchema.js'

const LogEventSchema = lazySchema(() =>
  z.object({
    method: z.literal('log_event'),
    params: z.object({
      eventName: z.string(),
      eventData: z.object({}).passthrough(),
    }),
  }),
)

export function useIdeLogging(mcpClients: MCPServerConnection[]): void {
// 订阅 IDE 经 MCP 发来的 log_event 通知，转成内部 analytics 事件（tengu_ide_<name>）。
  useEffect(() => {
    // Skip if there are no clients
    if (!mcpClients.length) {
      return
    }

    // Find the IDE client from the MCP clients list
    const ideClient = getConnectedIdeClient(mcpClients)
// 从 MCP 客户端列表里挑出 ide client；没有则本 hook 啥也不做。
    if (ideClient) {
      // Register the log event handler
      ideClient.client.setNotificationHandler(
        LogEventSchema(),
        notification => {
          const { eventName, eventData } = notification.params
          logEvent(
            `tengu_ide_${eventName}`,
            eventData as { [key: string]: boolean | number | undefined },
          )
        },
      )
// 注册处理器：把 IDE 上报的事件名与数据透传进 logEvent，eventData 用 passthrough 保留任意附加字段。
    }
  }, [mcpClients])
}
