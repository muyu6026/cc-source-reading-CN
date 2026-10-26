import uniqBy from 'lodash-es/uniqBy.js'
import { useMemo } from 'react'
import type { MCPServerConnection } from '../services/mcp/types.js'

export function mergeClients(
  initialClients: MCPServerConnection[] | undefined,
  mcpClients: readonly MCPServerConnection[] | undefined,
): MCPServerConnection[] {
  if (initialClients && mcpClients && mcpClients.length > 0) {
// 两者都有且 MCP 非空时合并去重；否则退回 initialClients 或空数组。
    return uniqBy([...initialClients, ...mcpClients], 'name')
  }
  return initialClients || []
// 按 name 去重，initialClients 优先于 mcpClients（同名的后者被忽略）。
}

export function useMergedClients(
  initialClients: MCPServerConnection[] | undefined,
  mcpClients: MCPServerConnection[] | undefined,
): MCPServerConnection[] {
// 用 useMemo 缓存合并结果，deps 为两个客户端数组；mergeClients 是纯函数便于单测。
  return useMemo(
    () => mergeClients(initialClients, mcpClients),
    [initialClients, mcpClients],
  )
}
