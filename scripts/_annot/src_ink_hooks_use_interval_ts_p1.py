# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (12, 'after', '''// ⚠️ 先记一个后果：keepAlive 为 false（第 30 行）意味着**它自己不驱动
// 时钟**。所以只用 useAnimationTimer 的组件永远不会动 —— 必须有别人
// （spinner、useAnimationFrame）在驱动 Clock。
//
// 这不是缺陷，是分工：时钟的唤醒成本只能由「确实需要连续刷新」的
// 组件承担。但读代码时容易把它当成「定时器 hook」误用，然后困惑
// 为什么时间不走。'''),
    (30, 'after', '''// keepAlive: false —— 搭便车。Clock 的 updateInterval 会检查
// 「订阅者里有没有 true」，没有就 clearInterval。
// 所以这里传 false 的直接效果是：本订阅者存在与否，不影响时钟跑不跑。'''),
    (42, 'after', '''// 下面这个 useInterval 是「合并定时器」的做法：不用 setInterval，
// 而是挂在共享 Clock 上，自己判断「距上次触发够不够 intervalMs」。
//
// 收益：一屏有十个每秒轮询的东西时，事件循环只被唤醒一次（Clock 那一次），
// 而不是十次。终端应用里每一次唤醒都可能触发一次重渲染，差别很明显。
//
// 代价：精度受 Clock 的 tick 间隔限制（FRAME_INTERVAL_MS ≈ 16ms），
// 而且**没人 keepAlive 时它不会触发** —— 和上面 useAnimationTimer
// 是同一个坑。'''),
    (48, 'after', '''// 在**渲染阶段**写 ref。React 的规则里这属于副作用，严格来说该用
// effect 同步；这里这么做是为了让 effect 里读到的永远是最新回调，
// 同时不必把 callback 放进依赖（否则调用方传内联箭头函数时，
// 每次都重新订阅）。
//
// 一个已知的边界：并发渲染下被丢弃的那次渲染也会写入这个 ref。
// 对「定时器回调」这种幂等场景无害，但如果 callback 里读了别的
// 渲染期状态，会读到一次「没提交的」版本。'''),
]
