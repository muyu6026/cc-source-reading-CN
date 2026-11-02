// 按「轮次」打标签的负载上下文。两个设计决定都写在注释里：为什么不放在全局状态模块——那个模块被浏览器入口传递依赖，而浏览器产物不能引入 Node 的异步钩子；为什么用异步上下文而不是全局可变槽位——被摘出去的背景智能体在第一个 await 处让出，父轮次的同步续行（含兜底的 finally）会先跑完，全局槽位写的标签必然被覆盖。
/**
 * Turn-scoped workload tag via AsyncLocalStorage.
 *
 * WHY a separate module from bootstrap/state.ts:
 * bootstrap is transitively imported by src/entrypoints/browser-sdk.ts, and
 * the browser bundle cannot import Node's async_hooks. This module is only
 * imported from CLI/SDK code paths that never end up in the browser build.
 *
 * WHY AsyncLocalStorage (not a global mutable slot):
 * void-detached background agents (executeForkedSlashCommand, AgentTool)
 * yield at their first await. The parent turn's synchronous continuation —
 * including any `finally` block — runs to completion BEFORE the detached
 * closure resumes. A global setWorkload('cron') at the top of the closure
 * is deterministically clobbered. ALS captures context at invocation time
 * and survives every await in that chain, isolated from the parent. Same
 * pattern as agentContext.ts.
 */

import { AsyncLocalStorage } from 'async_hooks'

/**
 * Server-side sanitizer (_sanitize_entrypoint in claude_code.py) accepts
 * only lowercase [a-z0-9_-]{0,32}. Uppercase stops parsing at char 0.
 */
export type Workload = 'cron'
export const WORKLOAD_CRON: Workload = 'cron'
// 标签类型只开了一个字面量，另一个等价常量单独导出。注释里说明了服务端清洗规则只接受小写字母、数字、下划线与连字符且最长三十二位——大写会让解析在第零个字符处中止，所以这里不改成驼峰或大写常量名。

const workloadStorage = new AsyncLocalStorage<{
  workload: string | undefined
}>()

export function getWorkload(): string | undefined {
  return workloadStorage.getStore()?.workload
}
// 取值只读当前上下文里的那一个字段，没有则返回 undefined。这里没有任何全局回退，正是为了让「没设置」与「设置为空」保持可区分。

/**
 * Wrap `fn` in a workload ALS context. ALWAYS establishes a new context
 * boundary, even when `workload` is undefined.
 *
 * The previous implementation short-circuited on `undefined` with
 * `return fn()` — but that's a pass-through, not a boundary. If the caller
 * is already inside a leaked cron context (REPL: queryGuard.end() →
 * _notify() → React subscriber → scheduled re-render captures ALS at
 * scheduling time → useQueueProcessor effect → executeQueuedInput → here),
 * a pass-through lets `getWorkload()` inside `fn` return the leaked tag.
 * Once leaked, it's sticky forever: every turn's end-notify re-propagates
 * the ambient context to the next turn's scheduling chain.
 *
 * Always calling `.run()` guarantees `getWorkload()` inside `fn` returns
 * exactly what the caller passed — including `undefined`.
 */
export function runWithWorkload<T>(
  workload: string | undefined,
  fn: () => T,
): T {
  return workloadStorage.run({ workload }, fn)
}
// 写入函数始终建立新的上下文边界，即使传入的值是 undefined。注释用一整段说明了为什么：旧实现遇到 undefined 直接调用原函数，那只是透传而不是边界；一旦调用方已经处在泄漏出来的标签上下文里（界面渲染链路上任何一次延迟捕获都会把上下文带到下一个轮次），透传就会让内部读到错误的标签，而且这种泄漏会自我延续、永不消失。总是走边界方法才能保证函数内部读到的正是调用方传入的值。
