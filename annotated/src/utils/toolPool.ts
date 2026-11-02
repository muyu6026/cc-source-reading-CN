// 工具池的合并与过滤。两件事：把初装工具与装配出来的工具合并去重并按名称排序，以及在协调者模式下裁到允许清单。刻意做成不依赖 React 的纯函数，好让无界面路径也能直接引用，不必把渲染层拉进依赖图。
import { feature } from 'bun:bundle'
import partition from 'lodash-es/partition.js'
import uniqBy from 'lodash-es/uniqBy.js'
import { COORDINATOR_MODE_ALLOWED_TOOLS } from '../constants/tools.js'
import { isMcpTool } from '../services/mcp/utils.js'
import type { Tool, ToolPermissionContext, Tools } from '../Tool.js'

// MCP tool name suffixes for PR activity subscription. These are lightweight
// orchestration actions the coordinator calls directly rather than delegating
// to workers. Matched by suffix since the MCP server name prefix may vary.
const PR_ACTIVITY_TOOL_SUFFIXES = [
  'subscribe_pr_activity',
  'unsubscribe_pr_activity',
]

export function isPrActivitySubscriptionTool(name: string): boolean {
  return PR_ACTIVITY_TOOL_SUFFIXES.some(suffix => name.endsWith(suffix))
}
// PR 活动订阅工具的识别用后缀匹配而不是全名，因为 MCP 服务名前缀可能变化，只有动作名是稳定的。这类工具属于轻量编排动作，协调者直接调用而不派给工作进程。

// Dead code elimination: conditional imports for feature-gated modules
/* eslint-disable @typescript-eslint/no-require-imports */
const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? (require('../coordinator/coordinatorMode.js') as typeof import('../coordinator/coordinatorMode.js'))
  : null
// 协调者模式模块用特性开关加运行期 require 组合做死代码消除：开关关闭时整个分支被裁掉，产物里不会包含该模块。这属于打包层面的取舍，与运行期功能判断无关。
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Filters a tool array to the set allowed in coordinator mode.
 * Shared between the REPL path (mergeAndFilterTools) and the headless
 * path (main.tsx) so both stay in sync.
 *
 * PR activity subscription tools are always allowed since subscription
 * management is orchestration.
 */
export function applyCoordinatorToolFilter(tools: Tools): Tools {
  return tools.filter(
    t =>
      COORDINATOR_MODE_ALLOWED_TOOLS.has(t.name) ||
      isPrActivitySubscriptionTool(t.name),
  )
}
// 过滤规则是「在允许清单内，或者是订阅类工具」。订阅管理被视为编排的一部分，所以始终放行，不随清单收紧。

/**
 * Pure function that merges tool pools and applies coordinator mode filtering.
 *
 * Lives in a React-free file so print.ts can import it without pulling
 * react/ink into the SDK module graph. The useMergedTools hook delegates
 * to this function inside useMemo.
 *
 * @param initialTools - Extra tools to include (built-in + startup MCP from props).
 * @param assembled - Tools from assembleToolPool (built-in + MCP, deduped).
 * @param mode - The permission context mode.
 * @returns Merged, deduplicated, and coordinator-filtered tool array.
 */
export function mergeAndFilterTools(
  initialTools: Tools,
  assembled: Tools,
  mode: ToolPermissionContext['mode'],
): Tools {
  // Merge initialTools on top - they take precedence in deduplication.
  // initialTools may include built-in tools (from getTools() in REPL.tsx) which
  // overlap with assembled tools. uniqBy handles this deduplication.
  // Partition-sort for prompt-cache stability (same as assembleToolPool):
  // built-ins must stay a contiguous prefix for the server's cache policy.
  const [mcp, builtIn] = partition(
    uniqBy([...initialTools, ...assembled], 'name'),
    isMcpTool,
  )
  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
  const tools = [...builtIn.sort(byName), ...mcp.sort(byName)]
// 合并顺序有讲究：初装工具放在前面，去重时优先保留它；随后按是否 MCP 工具切成两组，各自按名称排序再拼接。注释解释这是为了提示词缓存的稳定性——内置工具必须保持连续前缀，服务端才能命中缓存。

  if (feature('COORDINATOR_MODE') && coordinatorModeModule) {
    if (coordinatorModeModule.isCoordinatorMode()) {
      return applyCoordinatorToolFilter(tools)
    }
  }

  return tools
}
// 协调者过滤只在实际处于协调者模式时生效，两个条件都要成立，因为特性开关开启不代表当前会话就在该模式下运行。不满足条件时原样返回合并结果。
