# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (29, 'after', '''// 【两个停的条件，作用不同】
//
//   intervalMs === null  → 调用方主动暂停（比如动画结束了）
//   !isVisible           → 元素滚出视口，被动暂停
//
// 第二个是性能上的关键：一个全屏的应用里可能有几十个 spinner，
// 滚出去的那些如果还在每帧 setState，主线程就被白白占满了。
// 而且注意 active 同时控制下面 effect 的订阅 —— 不可见时**退订**，
// 于是 Clock 的 keepAlive 计数掉到 0，定时器整个停掉（见 ClockContext）。
// 这不是「少画几帧」，是「不唤醒事件循环」。'''),
    (37, 'after', '''// 这里把两个暂停条件合成一个布尔量。用 && 而不是把判断散在 effect 里，
// 是因为 active 同时是 effect 的依赖 —— 合成一个值，依赖数组就只写一个，
// 不用每处都记得把 isVisible 和 intervalMs 都列上。'''),
    (53, 'after', '''// keepAlive: true —— 可见的动画**负责驱动**这个时钟（订阅者里只要有一个
// true，Clock 就维持定时器）。
//
// 对照 use-interval.ts 里的 useAnimationTimer：它用 false，也就是
// 「搭便车」—— 有时钟在跑就跟着更新，没人在跑就永远不动。
// 两种用法必须配对：一个页面如果只有非 keepAlive 订阅者，动画是静止的。
// 这不是 bug，是「谁来承担唤醒成本」的显式选择。'''),
]
