/**
 * Agent context for analytics attribution using AsyncLocalStorage.
 *
 * This module provides a way to track agent identity across async operations
 * without parameter drilling. Supports two agent types:
 *
 * 1. Subagents (Agent tool): Run in-process for quick, delegated tasks.
 *    Context: SubagentContext with agentType: 'subagent'
 *
 * 2. In-process teammates: Part of a swarm with team coordination.
 *    Context: TeammateAgentContext with agentType: 'teammate'
 *
 * For swarm teammates in separate processes (tmux/iTerm2), use environment
 * variables instead: CLAUDE_CODE_AGENT_ID, CLAUDE_CODE_PARENT_SESSION_ID
 *
 * WHY AsyncLocalStorage (not AppState):
 * When agents are backgrounded (ctrl+b), multiple agents can run concurrently
 * in the same process. AppState is a single shared state that would be
 * overwritten, causing Agent A's events to incorrectly use Agent B's context.
 * AsyncLocalStorage isolates each async execution chain, so concurrent agents
 * don't interfere with each other.
 */
// 本文件用 AsyncLocalStorage 跟踪智能体身份，避免参数层层透传；
// 支持子智能体（Agent 工具）与进程内队友（集群）两类，跨并发异步链互不干扰。

import { AsyncLocalStorage } from 'async_hooks'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import { isAgentSwarmsEnabled } from './agentSwarmsEnabled.js'

/**
 * Context for subagents (Agent tool agents).
 * Subagents run in-process for quick, delegated tasks.
 */
// SubagentContext 描述子智能体上下文：UUID、父会话编号、类型名、是否内置、调用请求编号等。
export type SubagentContext = {
  /** The subagent's UUID (from createAgentId()) */
  agentId: string
  /** The team lead's session ID (from CLAUDE_CODE_PARENT_SESSION_ID env var), undefined for main REPL subagents */
  parentSessionId?: string
  /** Agent type - 'subagent' for Agent tool agents */
  agentType: 'subagent'
  /** The subagent's type name (e.g., "Explore", "Bash", "code-reviewer") */
  subagentName?: string
  /** Whether this is a built-in agent (vs user-defined custom agent) */
  isBuiltIn?: boolean
  /** The request_id in the invoking agent that spawned or resumed this agent.
   *  For nested subagents this is the immediate invoker, not the root —
   *  session_id already bundles the whole tree. Updated on each resume. */
  invokingRequestId?: string
  /** Whether this invocation is the initial spawn or a subsequent resume
   *  via SendMessage. Undefined when invokingRequestId is absent. */
  invocationKind?: 'spawn' | 'resume'
  /** Mutable flag: has this invocation's edge been emitted to telemetry yet?
   *  Reset to false on each spawn/resume; flipped true by
   *  consumeInvokingRequestId() on the first terminal API event. */
  invocationEmitted?: boolean
}

/**
 * Context for in-process teammates.
 * Teammates are part of a swarm and have team coordination.
 */
// TeammateAgentContext 描述集群队友上下文：完整代理编号、显示名、队名、颜色、是否队长等。
export type TeammateAgentContext = {
  /** Full agent ID, e.g., "researcher@my-team" */
  agentId: string
  /** Display name, e.g., "researcher" */
  agentName: string
  /** Team name this teammate belongs to */
  teamName: string
  /** UI color assigned to this teammate */
  agentColor?: string
  /** Whether teammate must enter plan mode before implementing */
  planModeRequired: boolean
  /** The team lead's session ID for transcript correlation */
  parentSessionId: string
  /** Whether this agent is the team lead */
  isTeamLead: boolean
  /** Agent type - 'teammate' for swarm teammates */
  agentType: 'teammate'
  /** The request_id in the invoking agent that spawned or resumed this
   *  teammate. Undefined for teammates started outside a tool call
   *  (e.g. session start). Updated on each resume. */
  invokingRequestId?: string
  /** See SubagentContext.invocationKind. */
  invocationKind?: 'spawn' | 'resume'
  /** Mutable flag: see SubagentContext.invocationEmitted. */
  invocationEmitted?: boolean
}

/**
 * Discriminated union for agent context.
 * Use agentType to distinguish between subagent and teammate contexts.
 */
// AgentContext 是两类上下文的判别联合，用 agentType 区分。
export type AgentContext = SubagentContext | TeammateAgentContext

const agentContextStorage = new AsyncLocalStorage<AgentContext>()
// 用 AsyncLocalStorage 存放当前智能体上下文，使同一进程内并发后台智能体不会互相覆盖。

/**
 * Get the current agent context, if any.
 * Returns undefined if not running within an agent context (subagent or teammate).
 * Use type guards isSubagentContext() or isTeammateAgentContext() to narrow the type.
 */
// getAgentContext 读取当前上下文，不在任何智能体上下文中时返回 undefined。
export function getAgentContext(): AgentContext | undefined {
  return agentContextStorage.getStore()
}

/**
 * Run an async function with the given agent context.
 * All async operations within the function will have access to this context.
 */
// runWithAgentContext 在给定上下文下运行函数，内部所有异步操作都能取到该上下文。
export function runWithAgentContext<T>(context: AgentContext, fn: () => T): T {
  return agentContextStorage.run(context, fn)
}

/**
 * Type guard to check if context is a SubagentContext.
 */
// isSubagentContext 是类型守卫，收窄上下文是否为子智能体。
export function isSubagentContext(
  context: AgentContext | undefined,
): context is SubagentContext {
  return context?.agentType === 'subagent'
}

/**
 * Type guard to check if context is a TeammateAgentContext.
 */
// isTeammateAgentContext 是类型守卫：仅在集群启用时认定 teammate，否则恒为假。
export function isTeammateAgentContext(
  context: AgentContext | undefined,
): context is TeammateAgentContext {
  if (isAgentSwarmsEnabled()) {
    return context?.agentType === 'teammate'
  }
  return false
}

/**
 * Get the subagent name suitable for analytics logging.
 * Returns the agent type name for built-in agents, "user-defined" for custom agents,
 * or undefined if not running within a subagent context.
 *
 * Safe for analytics metadata: built-in agent names are code constants,
 * and custom agents are always mapped to the literal "user-defined".
 */
// getSubagentLogName 取适合分析日志的子智能体名：内置用类型名，自定义统一映射为字面量 user-defined。
export function getSubagentLogName():
  | AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  | undefined {
  const context = getAgentContext()
  if (!isSubagentContext(context) || !context.subagentName) {
    return undefined
  }
  return (
    context.isBuiltIn ? context.subagentName : 'user-defined'
  ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Get the invoking request_id for the current agent context — once per
 * invocation. Returns the id on the first call after a spawn/resume, then
 * undefined until the next boundary. Also undefined on the main thread or
 * when the spawn path had no request_id.
 *
 * Sparse edge semantics: invokingRequestId appears on exactly one
 * tengu_api_success/error per invocation, so a non-NULL value downstream
 * marks a spawn/resume boundary.
 */
// consumeInvokingRequestId 每次 spawn 或 resume 后只取一次调用请求编号，标记边界后返回。
export function consumeInvokingRequestId():
  | {
      invokingRequestId: string
      invocationKind: 'spawn' | 'resume' | undefined
    }
  | undefined {
  const context = getAgentContext()
  if (!context?.invokingRequestId || context.invocationEmitted) {
    return undefined
  }
  context.invocationEmitted = true
  return {
    invokingRequestId: context.invokingRequestId,
    invocationKind: context.invocationKind,
  }
}
// consumeInvokingRequestId 收尾：主线程或没有请求编号时返回 undefined，避免重复上报。
