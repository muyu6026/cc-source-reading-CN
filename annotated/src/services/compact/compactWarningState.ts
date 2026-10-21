// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 补小件 4/6 —— 压缩警告的抑制状态
//                              （src/services/compact/compactWarningState.ts，18 行）
//
// 【这个文件只有一个布尔值，但它解决一个具体的时序问题】
//
// UI 上会显示"距离自动压缩还剩多少上下文"。压缩**成功之后**，
// 这个数字必须立刻隐藏 —— 因为压缩后的真实 token 数要等
// 下一次 API 响应返回 usage 才知道，在那之前界面上的数字是错的。
//
// 所以有了这个 store：
//   · 压缩成功 → suppressCompactWarning() → 警告消失
//   · 开始新的压缩尝试 → clearCompactWarningSuppression() → 警告恢复显示
//
// 【为什么不直接算？】
//
// 因为"算不出来"。压缩后本地只有估算值，而估算值和真实值可能差很多
// —— 显示一个错数字比不显示更糟（用户会以为还有余量，结果突然撞墙）。
// 宁可隐藏，等下一次真实数据回来。
//
// 【注意这个文件的定位：它是 state，不是 React】
//   下一个文件（compactWarningHook.ts）专门解释这个拆分。
import { createStore } from '../../state/store.js'

// 这段注释里 "We suppress immediately after successful compaction since
// we don't have accurate token counts until the next API response."
// 就是上面说的时序理由。
//
// 注意 "immediately" 这个词 —— 抑制必须是**同步立即**的。
// 如果等一个 effect 或者下一帧再隐藏，用户会看到一瞬间的错误数字闪一下。
// 这类"闪一下"在真实产品里非常显眼。
/**
 * Tracks whether the "context left until autocompact" warning should be suppressed.
 * We suppress immediately after successful compaction since we don't have accurate
 * token counts until the next API response.
 */
// `createStore<boolean>(false)` —— 初始值 false，即**默认显示警告**。
//
// 【默认值的选择是有讲究的】
//
//   false = 默认显示警告 = 默认"不抑制"
//
//   为什么默认要显示？因为显示警告是安全的一侧：用户看到"快满了"，
//   会主动整理上下文。而默认抑制 → 用户不知道快满了 → 突然被压缩，
//   中间那一段信息就丢了。
//
//   和 postCompactCleanup.ts 那个 `querySource?:` 正好相反：
//   那个默认值指向最危险的分支（当成主线程，多清东西），
//   这个默认值指向最安全的分支（显示警告）。
//
//   【对比着看很有价值：默认值该往哪边偏，取决于两侧的代价不对称性。】
//   宁可多显示一个警告，也不要让用户丢上下文。
export const compactWarningStore = createStore<boolean>(false)

// "Call after successful compaction" —— 成功之后，不是开始之时。
//
// 这个措辞很重要：如果压缩失败，警告应该继续显示（甚至更该显示）。
// 所以抑制的触发点在**成功路径**上，失败路径不该调它。
//
// 【这也解释了为什么 clear 的行为是"新的压缩尝试开始时清"】
//   新的尝试开始时清掉抑制 → 期间如果失败，警告会重新出现。
//   这是个自愈设计：成功才抑制，失败自然恢复。
/** Suppress the compact warning. Call after successful compaction. */
export function suppressCompactWarning(): void {
  compactWarningStore.setState(() => true)
}

/** Clear the compact warning suppression. Called at start of new compact attempt. */
export function clearCompactWarningSuppression(): void {
  compactWarningStore.setState(() => false)
}
