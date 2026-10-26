// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { useMemo } from 'react'
import type { Tools, ToolPermissionContext } from '../Tool.js'
import { assembleToolPool } from '../tools.js'
import { useAppState } from '../state/AppState.js'
import { mergeAndFilterTools } from '../utils/toolPool.js'

/**
 * React hook that assembles the full tool pool for the REPL.
 *
 * Uses assembleToolPool() (the shared pure function used by both REPL and runAgent)
 * to combine built-in tools with MCP tools, applying deny rules and deduplication.
 * Any extra initialTools are merged on top.
 *
 * @param initialTools - Extra tools to include (built-in + startup MCP from props).
 *   These are merged with the assembled pool and take precedence in deduplication.
 * @param mcpTools - MCP tools discovered dynamically (from mcp state)
 * @param toolPermissionContext - Permission context for filtering
 */
// 组装 REPL 完整工具池：复用 assembleToolPool（REPL 与 runAgent 共用的纯函数），再叠加 initialTools。
export function useMergedTools(
  initialTools: Tools,
  mcpTools: Tools,
  toolPermissionContext: ToolPermissionContext,
): Tools {
  let replBridgeEnabled = false
// replBridgeEnabled / replBridgeOutboundOnly 声明但未使用（疑似早期开关残留），仍列进 deps 保引用稳定。
  let replBridgeOutboundOnly = false
  return useMemo(() => {
    // assembleToolPool is the shared function that both REPL and runAgent use.
    // It handles: getTools() + MCP deny-rule filtering + dedup + MCP CLI exclusion.
    const assembled = assembleToolPool(toolPermissionContext, mcpTools)
// assembleToolPool 负责内置工具 + MCP 工具 + deny 过滤 + 去重；mergeAndFilterTools 再把 initialTools 合并进来并优先去重。

    return mergeAndFilterTools(
      initialTools,
      assembled,
      toolPermissionContext.mode,
    )
  }, [
    initialTools,
    mcpTools,
    toolPermissionContext,
    replBridgeEnabled,
    replBridgeOutboundOnly,
  ])
}
