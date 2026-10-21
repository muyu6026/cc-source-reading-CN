# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (9, 'after', '''// 【为什么是共享时钟，而不是各组件自己 setInterval】
//
// 两个收益，第二个才是主要的：
//
//   1. 一屏十个动画只唤醒事件循环一次（不是十次）
//   2. 同一 tick 里所有订阅者看到**同一个时间值** —— 于是多个动画
//      天然同步。各用各的 setInterval 时，相位是随机的，视觉上
//      两个 spinner 会一快一慢地错开
//
// 第 2 点的实现在 tick()（第 18 行）：先算一次 tickTime，再遍历通知。
// 如果每个订阅者自己 Date.now()，一毫秒的偏差就足够让动画错帧。'''),
    (57, 'after', '''// 【暂停时返回实时时间，不是返回上次的 tickTime】
//
// 定时器停掉之后 tickTime 就冻在最后一刻。如果 now() 一直返回它，
// 那么「暂停 10 秒后恢复」时，所有动画会从 10 秒前的位置接上 ——
// 看起来像时间倒退（对「已运行时长」这类展示更是明显错误）。
//
// 所以这里区分两种状态：定时器在跑 → 返回快照（同步性优先）；
// 停了 → 返回真实流逝时间（正确性优先）。
//
// 顺带一个边界：`if (interval && tickTime)` 里的 tickTime 是真值判断，
// 所以第一次 tick 如果恰好落在 0ms（Date.now() - startTime === 0），
// 会走 else 分支返回实时值 —— 结果一样，不影响正确性。'''),
    (68, 'after', '''// 这个对象的方法都在闭包里改 interval / startTime / tickTime，
// 所以 Clock 是个「有状态的服务对象」，不是纯函数集合。
//
// setTickInterval 的早退（第 63 行 `if (ms === currentTickIntervalMs) return`）
// 不是优化，是必要的：updateInterval 会 clearInterval + setInterval，
// 而它在每次 subscribe/unsubscribe 时都会被调用。如果没有早退，
// 一次「订阅者变化」就会把定时器的相位重置，动画会顿一下。'''),
    (70, 'after', '''// 失焦时把 tick 间隔翻倍（16ms → 32ms）。
//
// 折中的取值：完全停掉的话，用户切回来会看到画面停在某一帧，
// 而且要等一次交互才恢复；保持原速又白烧 CPU/电。
// 翻倍的效果是「动画还在动，但明显变慢」—— 用户不在看的时候
// 这个视觉代价为零。
//
// 注意 ClockProvider 只是改间隔，**不暂停** —— 暂停由订阅者的
// keepAlive 决定（见 use-animation-frame.ts 的 isVisible）。'''),
    (74, 'after', '''// 为什么单独抽一个 Provider 组件，而不是直接在 App 里 createClock：
//
// App 是 PureComponent，props 变化会重渲染整棵树。如果 clock 在 App 里
// 用 useMemo 造，虽然引用稳定，但 App 每次重渲染都会经过这段代码；
// 抽成子组件后，clock 的生命周期被隔离在 Provider 里 —— App 重渲染
// 不会碰到它。
//
// 这是「用组件边界做记忆化」的常见手法：比 useMemo 更彻底，
// 因为连 React 元素的创建都省了（children 是稳定引用）。'''),
]
