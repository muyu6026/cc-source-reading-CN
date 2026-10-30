import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logEvent } from '../services/analytics/index.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
} from '../services/mcp/types.js'
import type { Message } from '../types/message.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
// 本模块计算 MCP 服务器指令的「增量附件」：对比当前已连接的服务器与本次会话已播报过的服务器，得出新增/移除的指令块，用于把新接入服务器的指令追加进系统提示。

export type McpInstructionsDelta = {
// 增量结果结构：addedNames 为新增服务器名（用于无状态扫描重建），addedBlocks 为对应的「## 名称 加换行 指令」文本块，removedNames 为移除的服务器名。
  /** Server names — for stateless-scan reconstruction. */
  addedNames: string[]
  /** Rendered "## {name}\n{instructions}" blocks for addedNames. */
  addedBlocks: string[]
  removedNames: string[]
}

/**
 * Client-authored instruction block to announce when a server connects,
 * in addition to (or instead of) the server's own `InitializeResult.instructions`.
 * Lets first-party servers (e.g., claude-in-chrome) carry client-side
 * context the server itself doesn't know about.
 */
// 客户端自带的指令块，用于在服务器自身 InitializeResult.instructions 之外（或替代之）补充上下文，例如 claude-in-chrome 携带服务器不知道的信息。
export type ClientSideInstruction = {
  serverName: string
  block: string
}

/**
 * True → announce MCP server instructions via persisted delta attachments.
 * False → prompts.ts keeps its DANGEROUS_uncachedSystemPromptSection
 * (rebuilt every turn; cache-busts on late connect).
 *
 * Env override for local testing: CLAUDE_CODE_MCP_INSTR_DELTA=true/false
 * wins over both ant bypass and the GrowthBook gate.
 */
// 开关函数——决定是否通过持久化增量附件播报 MCP 指令。环境变量 CLAUDE_CODE_MCP_INSTR_DELTA 优先生效（true/false），否则看 USER_TYPE=ant 或 GrowthBook 灰度开关 tengu_basalt_3kr。
export function isMcpInstructionsDeltaEnabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_MCP_INSTR_DELTA)) return true
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_MCP_INSTR_DELTA)) return false
  return (
    process.env.USER_TYPE === 'ant' ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_basalt_3kr', false)
  )
}

/**
 * Diff the current set of connected MCP servers that have instructions
 * (server-authored via InitializeResult, or client-side synthesized)
 * against what's already been announced in this conversation. Null if
 * nothing changed.
 *
 * Instructions are immutable for the life of a connection (set once at
 * handshake), so the scan diffs on server NAME, not on content.
 */
// 核心 diff 函数——扫描消息历史里的已播报附件、收集 connected 服务器、合并服务器指令与客户端补充指令，产出本次新增/移除的服务器名与指令块。指令在连接生命周期内不可变，所以只按服务器名 diff，不按内容。
export function getMcpInstructionsDelta(
  mcpClients: MCPServerConnection[],
  messages: Message[],
  clientSideInstructions: ClientSideInstruction[],
): McpInstructionsDelta | null {
  const announced = new Set<string>()
// 先建一个集合记录本会话已播报过的服务器名：遍历附件时，addedNames 加入、removedNames 删除。
  let attachmentCount = 0
  let midCount = 0
  for (const msg of messages) {
    if (msg.type !== 'attachment') continue
    attachmentCount++
    if (msg.attachment.type !== 'mcp_instructions_delta') continue
    midCount++
    for (const n of msg.attachment.addedNames) announced.add(n)
    for (const n of msg.attachment.removedNames) announced.delete(n)
  }

  const connected = mcpClients.filter(
    (c): c is ConnectedMCPServer => c.type === 'connected',
  )
  const connectedNames = new Set(connected.map(c => c.name))

  // Servers with instructions to announce (either channel). A server can
  // have both: server-authored instructions + a client-side block appended.
  const blocks = new Map<string, string>()
// 收集需要播报的服务器——同一服务器可同时有「服务器自带指令」和「客户端补充块」，二者合并。
  for (const c of connected) {
    if (c.instructions) blocks.set(c.name, `## ${c.name}\n${c.instructions}`)
  }
  for (const ci of clientSideInstructions) {
    if (!connectedNames.has(ci.serverName)) continue
    const existing = blocks.get(ci.serverName)
    blocks.set(
      ci.serverName,
      existing
        ? `${existing}\n\n${ci.block}`
        : `## ${ci.serverName}\n${ci.block}`,
    )
  }

  const added: Array<{ name: string; block: string }> = []
// 遍历所有待播报块，找出尚未播报过的（announced 里没有的）作为新增项。
  for (const [name, block] of blocks) {
    if (!announced.has(name)) added.push({ name, block })
  }

  // A previously-announced server that is no longer connected → removed.
  // There is no "announced but now has no instructions" case for a still-
  // connected server: InitializeResult is immutable, and client-side
  // instruction gates are session-stable in practice. (/model can flip
  // the model gate, but deferred_tools_delta has the same property and
  // we treat history as historical — no retroactive retractions.)
// 对「曾经播报过、现已不连接」的服务器记为 removed。已连接服务器不会出现「播报过但无指令」的情况（InitializeResult 不可变），故历史即为历史、不做回溯撤销。
  const removed: string[] = []
  for (const n of announced) {
    if (!connectedNames.has(n)) removed.push(n)
  }

  if (added.length === 0 && removed.length === 0) return null
// 无新增也无移除时返回 null，表示本次没有变化、无需写附件。

  // Same diagnostic fields as tengu_deferred_tools_pool_change — same
  // scan-fails-in-prod bug, same attachment persistence path.
  logEvent('tengu_mcp_instructions_pool_change', {
// 上报遥测事件 tengu_mcp_instructions_pool_change，字段与 deferred_tools_delta 一致（同款「生产环境扫描崩溃」问题、同款附件持久化路径）。
    addedCount: added.length,
    removedCount: removed.length,
    priorAnnouncedCount: announced.size,
    clientSideCount: clientSideInstructions.length,
    messagesLength: messages.length,
    attachmentCount,
    midCount,
  })

  added.sort((a, b) => a.name.localeCompare(b.name))
// 新增项按服务器名字母序排序后返回，保证输出稳定、可复现。
  return {
    addedNames: added.map(a => a.name),
    addedBlocks: added.map(a => a.block),
    removedNames: removed.sort(),
  }
}
