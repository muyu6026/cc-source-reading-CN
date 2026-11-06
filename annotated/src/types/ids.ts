/**
 * Branded types for session and agent IDs.
 * These prevent accidentally mixing up session IDs and agent IDs at compile time.
 */
// 文件头注释：会话 ID 与智能体 ID 的品牌类型（branded types），在编译期防止两者混用。

/**
 * A session ID uniquely identifies a Claude Code session.
 * Returned by getSessionId().
 */
// 注释：SessionId 的语义——唯一标识一次 Claude Code 会话，由 getSessionId() 返回。
export type SessionId = string & { readonly __brand: 'SessionId' }
// SessionId 品牌类型：字符串叠加只读 __brand 标记，实现编译期区分。

/**
 * An agent ID uniquely identifies a subagent within a session.
 * Returned by createAgentId().
 * When present, indicates the context is a subagent (not the main session).
 */
// 注释：AgentId 的语义——标识会话内的子智能体，存在即说明当前上下文是子智能体。
export type AgentId = string & { readonly __brand: 'AgentId' }
// AgentId 品牌类型。

/**
 * Cast a raw string to SessionId.
 * Use sparingly - prefer getSessionId() when possible.
 */
// 注释：asSessionId 将原始字符串转换为 SessionId。
export function asSessionId(id: string): SessionId {
// asSessionId 实现：直接类型断言；注释提醒谨慎使用、优先用 getSessionId()。
  return id as SessionId
}

/**
 * Cast a raw string to AgentId.
 * Use sparingly - prefer createAgentId() when possible.
 */
// 注释：asAgentId 将原始字符串转换为 AgentId。
export function asAgentId(id: string): AgentId {
// asAgentId 实现：直接类型断言。
  return id as AgentId
}

const AGENT_ID_PATTERN = /^a(?:.+-)?[0-9a-f]{16}$/
// 智能体 ID 正则：a + 可选 <label>- + 16 位十六进制。

/**
 * Validate and brand a string as AgentId.
 * Matches the format produced by createAgentId(): `a` + optional `<label>-` + 16 hex chars.
 * Returns null if the string doesn't match (e.g. teammate names, team-addressing).
 */
// 注释：toAgentId 校验字符串并品牌化为 AgentId，格式不匹配时返回 null。
export function toAgentId(s: string): AgentId | null {
// toAgentId 实现：正则匹配则品牌化，否则返回 null。
  return AGENT_ID_PATTERN.test(s) ? (s as AgentId) : null
}
