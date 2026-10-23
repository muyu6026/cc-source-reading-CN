import { feature } from 'bun:bundle'
import { isReplBridgeActive } from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type { Tool } from '../../Tool.js'
import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'

// Dead code elimination: Brief tool name only needed when KAIROS or KAIROS_BRIEF is on
/* eslint-disable @typescript-eslint/no-require-imports */
// BRIEF_TOOL_NAME / SEND_USER_FILE_TOOL_NAME 用条件 require 按需引入——与 ExitPlanModeV2Tool 的 autoModeState 同款手法：特性关闭时连 import 边都不存在，打包器能整棵砍掉，顶层副作用（如模块级常量初始化）不会残留。eslint-disable 圈出这两块，因为 no-require-imports 规则在这里是故意违反的。
const BRIEF_TOOL_NAME: string | null =
  feature('KAIROS') || feature('KAIROS_BRIEF')
    ? (
        require('../BriefTool/prompt.js') as typeof import('../BriefTool/prompt.js')
      ).BRIEF_TOOL_NAME
    : null
const SEND_USER_FILE_TOOL_NAME: string | null = feature('KAIROS')
  ? (
      require('../SendUserFileTool/prompt.js') as typeof import('../SendUserFileTool/prompt.js')
    ).SEND_USER_FILE_TOOL_NAME
  : null

/* eslint-enable @typescript-eslint/no-require-imports */

export { TOOL_SEARCH_TOOL_NAME } from './constants.js'

import { TOOL_SEARCH_TOOL_NAME } from './constants.js'

// PROMPT_HEAD 一句话定位：本工具是「deferred 工具的 schema 取货口」。
const PROMPT_HEAD = `Fetches full schema definitions for deferred tools so they can be called.

`

// Matches isDeferredToolsDeltaEnabled in toolSearch.ts (not imported —
// toolSearch.ts imports from this file). When enabled: tools announced
// via system-reminder attachments. When disabled: prepended
// <available-deferred-tools> block (pre-gate behavior).
// getToolLocationHint 按 glacier_2xr 开关或 ant 用户决定提示词说 deferred 工具出现在哪种消息里——system-reminder 附件（delta 模式）还是 available-deferred-tools 块（旧模式）。注释特意说明这里的常量与 toolSearch.ts 的开关是「匹配而非导入」关系——那个文件 import 本文件，反向 import 会成环，所以两个常量必须各自维护、注释互相锚定。
function getToolLocationHint(): string {
  const deltaEnabled =
    process.env.USER_TYPE === 'ant' ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_glacier_2xr', false)
  return deltaEnabled
    ? 'Deferred tools appear by name in <system-reminder> messages.'
    : 'Deferred tools appear by name in <available-deferred-tools> messages.'
}

// PROMPT_TAIL 讲清机制与查询语法：未取 schema 前工具「看得见摸不着」（只有名字，调不了）；取到后 schema 以 <functions> 块下发，与 prompt 顶部的工具列表同一编码；三种查询形式（select: 直选 / 关键词 / +必选词）。整段是在给模型上一堂「延迟加载工具系统」的微型课程。
const PROMPT_TAIL = ` Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked. This tool takes a query, matches it against the deferred tool list, and returns the matched tools' complete JSONSchema definitions inside a <functions> block. Once a tool's schema appears in that result, it is callable exactly like any tool defined at the top of the prompt.

Result format: each matched tool appears as one <function>{"description": "...", "name": "...", "parameters": {...}}</function> line inside the <functions> block — the same encoding as the tool list at the top of this prompt.

Query forms:
- "select:Read,Edit,Grep" — fetch these exact tools by name
- "notebook jupyter" — keyword search, up to max_results best matches
- "+slack send" — require "slack" in the name, rank by remaining terms`

/**
 * Check if a tool should be deferred (requires ToolSearch to load).
 * A tool is deferred if:
 * - It's an MCP tool (always deferred - workflow-specific)
 * - It has shouldDefer: true
 *
 * A tool is NEVER deferred if it has alwaysLoad: true (MCP tools set this via
 * _meta['anthropic/alwaysLoad']). This check runs first, before any other rule.
 */
// isDeferredTool 判定链，顺序即优先级：① alwaysLoad 显式退出优先（MCP 工具靠 _meta 注解退出延迟加载，这条必须最先——否则 MCP 全被默认延迟）；② MCP 工具一律延迟（工作流特定，不是每轮都需要）；③ ToolSearch 自己永不延迟（递归悖论——延迟它就没法取任何 schema）；④ FORK_SUBAGENT 下 Agent 工具若走 fork 模式则退出延迟（第一轮就要能派子代理，惰性 require 同样为破环）；⑤ KAIROS 下 Brief/SendUserFile 退出延迟——它们是通信主通道，提示词里的可见性契约不能让模型先搜一轮才看到；⑥ 兜底才是 shouldDefer 标志。
export function isDeferredTool(tool: Tool): boolean {
  // Explicit opt-out via _meta['anthropic/alwaysLoad'] — tool appears in the
  // initial prompt with full schema. Checked first so MCP tools can opt out.
  if (tool.alwaysLoad === true) return false

  // MCP tools are always deferred (workflow-specific)
  if (tool.isMcp === true) return true

  // Never defer ToolSearch itself — the model needs it to load everything else
  if (tool.name === TOOL_SEARCH_TOOL_NAME) return false

  // Fork-first experiment: Agent must be available turn 1, not behind ToolSearch.
  // Lazy require: static import of forkSubagent → coordinatorMode creates a cycle
  // through constants/tools.ts at module init.
  if (feature('FORK_SUBAGENT') && tool.name === AGENT_TOOL_NAME) {
    type ForkMod = typeof import('../AgentTool/forkSubagent.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('../AgentTool/forkSubagent.js') as ForkMod
    if (m.isForkSubagentEnabled()) return false
  }

  // Brief is the primary communication channel whenever the tool is present.
  // Its prompt contains the text-visibility contract, which the model must
  // see without a ToolSearch round-trip. No runtime gate needed here: this
  // tool's isEnabled() IS isBriefEnabled(), so being asked about its deferral
  // status implies the gate already passed.
  if (
    (feature('KAIROS') || feature('KAIROS_BRIEF')) &&
    BRIEF_TOOL_NAME &&
    tool.name === BRIEF_TOOL_NAME
  ) {
    return false
  }

  // SendUserFile is a file-delivery communication channel (sibling of Brief).
  // Must be immediately available without a ToolSearch round-trip.
  if (
    feature('KAIROS') &&
    SEND_USER_FILE_TOOL_NAME &&
    tool.name === SEND_USER_FILE_TOOL_NAME &&
    isReplBridgeActive()
  ) {
    return false
  }

  return tool.shouldDefer === true
}

/**
 * Format one deferred-tool line for the <available-deferred-tools> user
 * message. Search hints (tool.searchHint) are not rendered — the
 * hints A/B (exp_xenhnnmn0smrx4, stopped Mar 21) showed no benefit.
 */
// formatDeferredToolLine 只输出工具名——注释记录了一次实验判决：searchHint A/B 实验（exp_xenhnnmn0smrx4，3 月 21 日停止）证明提示行里加能力短语无收益，于是砍到只剩名字。deferred 列表的每一行都在消耗每轮上下文，无收益即删除。
export function formatDeferredToolLine(tool: Tool): string {
  return tool.name
}

// getPrompt 三段拼装：HEAD + 位置提示（按开关二选一）+ TAIL。整份提示词运行时才定型——同一个工具在不同特性组合下给模型的「使用说明书」不同。
export function getPrompt(): string {
  return PROMPT_HEAD + getToolLocationHint() + PROMPT_TAIL
}
