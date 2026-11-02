/**
 * TeammateContext - Runtime context for in-process teammates
 *
 * This module provides AsyncLocalStorage-based context for in-process teammates,
 * enabling concurrent teammate execution without global state conflicts.
 *
 * Relationship with other teammate identity mechanisms:
 * - Env vars (CLAUDE_CODE_AGENT_ID): Process-based teammates spawned via tmux
 * - dynamicTeamContext (teammate.ts): Process-based teammates joining at runtime
 * - TeammateContext (this file): In-process teammates via AsyncLocalStorage
 *
 * The helper functions in teammate.ts check AsyncLocalStorage first, then
 * dynamicTeamContext, then env vars.
 */
// 进程内队友的运行时上下文：用 AsyncLocalStorage 承载身份，使同一进程里的多个队友并发执行也不会互相串味。

import { AsyncLocalStorage } from 'async_hooks'
// AsyncLocalStorage 是关键：上下文随异步调用链自动传播，不必把 agentId 一层层显式传进每个函数。

/**
 * Runtime context for in-process teammates.
 * Stored in AsyncLocalStorage for concurrent access.
 */
export type TeammateContext = {
  /** Full agent ID, e.g., "researcher@my-team" */
  agentId: string
  /** Display name, e.g., "researcher" */
  agentName: string
  /** Team name this teammate belongs to */
  teamName: string
  /** UI color assigned to this teammate */
  color?: string
  /** Whether teammate must enter plan mode before implementing */
  planModeRequired: boolean
  /** Leader's session ID (for transcript correlation) */
  parentSessionId: string
  /** Discriminator - always true for in-process teammates */
  isInProcess: true
  /** Abort controller for lifecycle management (linked to parent) */
  abortController: AbortController
}
// 字段刻意做成扁平结构：agentId 是全名（名字@团队），agentName 是显示名，二者分开是为了日志里能直接读、UI 里能只显示短名。

const teammateContextStorage = new AsyncLocalStorage<TeammateContext>()
// 模块级单例即上下文容器：一个 store 就够，因为 ALS 按调用链隔离，不需要按队友建多个实例。

/**
 * Get the current in-process teammate context, if running as one.
 * Returns undefined if not running within an in-process teammate context.
 */
export function getTeammateContext(): TeammateContext | undefined {
  return teammateContextStorage.getStore()
}
// getTeammateContext 返回 undefined 表示当前不在任何队友上下文里，调用方据此回退到进程级身份（环境变量或 dynamicTeamContext）。

/**
 * Run a function with teammate context set.
 * Used when spawning an in-process teammate to establish its execution context.
 *
 * @param context - The teammate context to set
 * @param fn - The function to run with the context
 * @returns The return value of fn
 */
export function runWithTeammateContext<T>(
  context: TeammateContext,
  fn: () => T,
): T {
  return teammateContextStorage.run(context, fn)
}
// runWithTeammateContext 用 run 而不是 enterWith：run 的作用域在函数返回时自动退出，不会把上下文泄漏到调用者后续的异步任务里。

/**
 * Check if current execution is within an in-process teammate.
 * This is faster than getTeammateContext() !== undefined for simple checks.
 */
export function isInProcessTeammate(): boolean {
  return teammateContextStorage.getStore() !== undefined
}
// isInProcessTeammate 只做存在性判断：比先取值再比较快，适合放在热路径上（每条工具调用都会查一次）。

/**
 * Create a TeammateContext from spawn configuration.
 * The abortController is passed in by the caller. For in-process teammates,
 * this is typically an independent controller (not linked to parent) so teammates
 * continue running when the leader's query is interrupted.
 *
 * @param config - Configuration for the teammate context
 * @returns A complete TeammateContext with isInProcess: true
 */
export function createTeammateContext(config: {
  agentId: string
  agentName: string
  teamName: string
  color?: string
  planModeRequired: boolean
  parentSessionId: string
  abortController: AbortController
}): TeammateContext {
  return {
    ...config,
    isInProcess: true,
  }
}
// createTeammateContext 只补 isInProcess 标记：其余字段原样展开，调用方传什么就是什么，避免这里再维护一份默认值。
