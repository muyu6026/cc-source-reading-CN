// ═══════════════════════════════════════════════════════════════
//  终端焦点：模块级状态 + 两套订阅机制
// ═══════════════════════════════════════════════════════════════
//
//  这是一个「React 之外的单例状态，但要能被 React 读到」的标准解法。
//  为什么不能放 React state：焦点变化的**源头在 React 之外**
//  （DECSET 1004 的转义序列从 stdin 来，由 App.tsx 的 stdin 处理器
//  解析），而 React state 的写入必须在 React 的调度里。
//
//  于是：模块级变量 + `useSyncExternalStore` 的订阅接口。这是 React 18
//  官方推荐的「接入外部 store」的方式 —— 它也顺便解决了并发渲染下的
//  tearing（同一帧里不同组件读到不同值）。
// Terminal focus state signal — non-React access to DECSET 1004 focus events.
// 'unknown' is the default for terminals that don't support focus reporting;
// consumers treat 'unknown' identically to 'focused' (no throttling).
// Subscribers are notified synchronously when focus changes, used by
// TerminalFocusProvider to avoid polling.
//  ── 三态而不是两态 ──
//
//  `'unknown'` 的存在是这个文件的精巧之处。两态（focused/blurred）的话，
//  「终端不支持焦点上报」会被误判成 blurred —— 然后依赖焦点的逻辑
//  （暂停动画、降低刷新率、不弹通知）就全部生效，而用户明明在看。
//
//  三态让「不知道」成为一个可表达的状态，且**消费方的默认行为是
//  「当作 focused」**（`getTerminalFocused()` 用的是 `!== 'blurred'`）。
//  这是正确的默认：宁可多跑一点动画，也不要让界面「以为没人在看」
//  而停止刷新。
export type TerminalFocusState = 'focused' | 'blurred' | 'unknown'

let focusState: TerminalFocusState = 'unknown'
const resolvers: Set<() => void> = new Set()
const subscribers: Set<() => void> = new Set()

// 两套订阅，用途完全不同，别混：
//
//   `subscribers` —— `useSyncExternalStore` 的监听器。每次状态变都通知，
//                     React 会重新读快照（`getTerminalFocusState`）。
//   `resolvers`   —— 一次性等待者。「等用户离开」这类语义
//                    （比如 `useAwaySummary`：用户离开一段时间后生成摘要）。
//
//  关键不对称：**resolvers 只在失焦时 resolve**。所以它是「等一个
//  特定事件」而不是「等状态变化」。这份不对称是刻意的 —— 想等
//  「焦点变了」的人应该用 subscribers。
export function setTerminalFocused(v: boolean): void {
  focusState = v ? 'focused' : 'blurred'
  // Notify useSyncExternalStore subscribers
  for (const cb of subscribers) {
    cb()
  }
// 只有 `!v`（失焦）才 resolve 所有 resolvers，然后**清空**。
//
//  清空是必需的：一次性承诺的东西 resolve 完之后必须移除，
//  否则下次失焦会对已经 resolve 过的 promise 再 resolve 一次
//  （无害但是泄漏，set 会一直变大）。
//
//  注意这个顺序：先通知 subscribers（同步），再 resolve resolvers。
//  反过来也能工作，但先通知订阅者更符合直觉（状态先变，事件后发）。
  if (!v) {
    for (const resolve of resolvers) {
      resolve()
    }
    resolvers.clear()
  }
}

// `focusState !== 'blurred'` —— 于是 unknown 被当成 focused。
//  这个默认值的选择理由见文件头批注：宁可多跑，不要装死。
//
//  对比 `getTerminalFocusState()` 返回原始三态 —— 需要区分
//  「知道在看」和「不知道」的调用方用后者。
export function getTerminalFocused(): boolean {
  return focusState !== 'blurred'
}

export function getTerminalFocusState(): TerminalFocusState {
  return focusState
}

// For useSyncExternalStore
export function subscribeTerminalFocus(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

// 重置成 unknown 并通知所有订阅者。
//
//  什么时候需要重置：终端能力探测重新开始时（比如从某个暂停状态
//  恢复，1004 模式被重新打开，之前的焦点状态不再可信）。
//
//  注意这里**不 resolve resolvers** —— 重置不是「失焦」，
//  等离开的人应该继续等。
export function resetTerminalFocusState(): void {
  focusState = 'unknown'
  for (const cb of subscribers) {
    cb()
  }
}
