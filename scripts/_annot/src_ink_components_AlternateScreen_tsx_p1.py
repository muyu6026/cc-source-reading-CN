# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (32, 'after', '''// 这个组件的核心不是「进全屏」，而是**进出必须成对、且顺序固定**。
//
// 进：ENTER_ALT_SCREEN + 清屏 + 光标归位 + （可选）鼠标追踪
// 出：关鼠标追踪 + EXIT_ALT_SCREEN
//
// 顺序为什么不能换：如果先退全屏再关鼠标追踪，那一小段时间里鼠标
// 事件仍然会发，但屏幕已经是主屏了 —— 坐标对不上，可能出现
// 「退出全屏的瞬间触发了主屏上某个点击」。
//
// 另外注意 `ink?.setAltScreenActive(...)`：这个组件不只是写序列，
// 它还要**告诉渲染器**现在是全屏。渲染器的行为差别很大 ——
// 全屏时光标要留在视口内（否则帧末的光标归位会触发滚动），
// 而且清理路径也不同（signal-exit 也要能退出全屏）。'''),
    (50, 'after', '''// 进场序列是三段拼起来的，中间的 `"\\u001B[2J\\u001B[H"` 是清屏 + 归位。
//
// 为什么必须清屏：alt screen 的内容是上一个程序留下的（通常是 shell），
// 不清的话第一帧渲染前会闪一下旧内容。
//
// 为什么必须归位：进入 alt screen 后光标位置是未定义的（不同终端
// 不同），不归位的话第一帧可能从屏幕中间开始画。'''),
    (55, 'after', '''// 【cleanup 的三步顺序】
//
//   1. setAltScreenActive(false)  先让渲染器知道「不再全屏」
//   2. clearTextSelection()       清掉选区（否则退出后还可能触发复制）
//   3. 写关鼠标 + 退全屏
//
// 第 1 步和第 3 步的顺序是关键：如果先写 EXIT_ALT_SCREEN，渲染器在
// 那之后、setAltScreenActive(false) 之前若正好渲染一帧，它会按
// 「全屏模式」的规则把光标限制在视口内 —— 而视口已经不存在了。
//
// 反过来（先告诉渲染器）是安全的：最坏情况是渲染器按主屏规则多画
// 一帧到 alt screen 上，而那个屏幕马上就要被丢弃。'''),
    (67, 'after', '''// ⚠️ `useInsertionEffect`，不是 `useLayoutEffect`。
//
// 三个 effect 的时序：render → **insertion**（mutation 阶段）
// → layout（DOM 已更新）→ passive（useEffect）。
//
// 选 insertion 的理由：全屏切换必须在**任何布局测量之前**发生。
// 用 layout 的话，同一棵树里其他组件的 layout effect 可能先跑
// （React 按子→父的顺序跑 layout effect，但兄弟之间按挂载顺序），
// 那时 rows 还是旧值、alt screen 还没进 —— 于是第一帧按主屏高度算，
// 渲染完再跳一次。
//
// 代价（insertion effect 的限制）：不能在里面读布局、不能 setState。
// 这里两件事都没做，只写序列和调 setAltScreenActive，正好合适。'''),
    (68, 'after', '''// `?? 24` 是硬兜底：TerminalSizeContext 的默认值是 null（见
// TerminalSizeContext.tsx），而全屏必须有一个确定高度 ——
// 拿不到真实行数时宁可假设 24 行（VT100 的经典尺寸），也不要
// 让 height 变成 undefined（yoga 会当成 auto，于是全屏失效）。'''),
]
