# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (28, 'after', '''// 【「不改 state」是这份实现的核心决定】
//
// 可见性变化不触发重渲染，只在 ref 里记一笔 —— 因为布局阶段 setState
// 会和别的 layout effect 形成循环（A 的 effect 让 B 重渲染，B 的 effect
// 又让 A 重渲染）。代价是：`entry` 的变化只有在下一次渲染时才被看到。
//
// 所以它真正的用法是「和动画一起用」（useAnimationFrame 就是这么做的：
// 每次 tick 都会重渲染，顺手读到最新的 isVisible）。单独用它监视
// 可见性，是收不到通知的 —— 返回的对象不是 state，是个 ref 快照。'''),
    (46, 'after', '''// 每次渲染都跑（没有依赖数组），因为 yoga 的布局值可以在 React
// 完全不知情的情况下变化（比如父容器尺寸变了、内容变多了）。
//
// 这一点和 useDeclaredCursor 是同一个理由：layout 阶段读到的才是
// 这一帧的真实几何。'''),
    (61, 'after', '''// 【为什么走 DOM 父链而不是 yoga 父链】
//
// yoga 的 getComputedTop 给的是**布局位置**，不含滚动偏移 ——
// 滚动是渲染期才应用的（render-node-to-output 把 scrollTop 减掉）。
// 所以一个在 ScrollBox 里滚到视口内的元素，它的 yoga 位置可能已经
// 远超 terminalRows，按 yoga 判会被当成「不可见」→ 动画停掉，
// 而用户明明看得见。
//
// 走 DOM 链才能在每一层检查 scrollTop 并把偏移减回去。
// 这也是「几何有两个真相（布局位置 / 屏幕位置）」的又一例 ——
// 上一批 selection.ts 栽的是同一类跟头。'''),
    (85, 'after', '''// 【这一行必须和 log-update.ts 对齐】
//
// 内容超过视口高度时，帧末的「光标归位」会多发一个换行，把内容顶进
// scrollback 一行（log-update 里记为 scrollbackRows = viewportY + 1）。
// 所以这里的视口底部也要往下挪一行。
//
// 不对齐会怎样：某个元素处在边界上，这里判「可见」→ 动画继续 tick →
// 每次 tick 都改内容 → log-update 认为内容变了 → 触发全量重置 → 闪。
// 表现出来是「某个 spinner 一开始转，屏幕就开始闪」，而 spinner 本身
// 完全无辜。这种跨模块的隐形契约是最难查的一类。'''),
    (95, 'after', '''// 返回的是 entryRef.current，不是 entryRef 本身。
// 所以调用方拿到的是**那一刻的快照对象**：可见性翻转时会换成新对象
// （第 91 行整个替换），没变时是同一个引用 —— 这个引用相等性就是
// 调用方判断「要不要重新处理」的依据。
//
// 反过来说：把返回值存进 state 或依赖数组是安全的（稳定），
// 但在 effect 里读它只能拿到上一次渲染时的值。'''),
]
