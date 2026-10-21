# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  事件派发：把一次按键沿着 DOM 树走两遍
// ═══════════════════════════════════════════════════════════════
//
//  这个文件做三件事，三件都容易低估：
//
//  1. 收集监听者（collectListeners）—— 一趟走完，得到
//     「根 capture → … → target → … → 根 bubble」这一个数组
//  2. 执行并处理停止（processDispatchQueue）—— 三处传播语义
//  3. 给 React 报告优先级（resolveEventPriority）—— reconciler
//     的 host config 会读，决定这次更新是同步还是延后
//
//  第 3 件是最容易被忽略的：它没有出现在任何一次 call site 里，
//  而是在 reconciler.ts:492 被当作 host config 的方法读走。
//  一个「设置当前派发事件」的动作，副作用是「React 知道这次更新有多急」。
//
//  ── 谁真正走这条路 ──
//  全仓库只有两个入口，都在 ink.tsx：
//    · 234 行 FocusManager 构造时注入的派发器 → focus / blur
//    · 1272 行 dispatchKeyboardEvent          → keydown
//  ClickEvent 不在其中（hit-test.ts 自己写了 while 循环），
//  所以下面 getEventPriority 里 'click' / 'scroll' / 'resize' /
//  'mousemove' 那几行分支实际上是够不着的。'''),
    (45, 'after', '''// 【为什么一趟能出两个方向】
//
// 从 target 往上走，每遇到一个节点：
//   capture handler → unshift 到数组头
//   bubble  handler → push 到数组尾
//
// capture 是倒着塞的，所以越靠近根越靠前；bubble 是正着塞的，
// 所以越靠近 target 越靠前。走完一遍，数组天然就是
// [rootCap, …, parentCap, targetCap, targetBub, parentBub, …, rootBub]。
//
// 换成两趟（先从头往下收 capture，再从尾往上收 bubble）也能得到同样
// 结果，但要走两遍链、还得在中间存一份节点列表。react-dom 用的就是
// 这个一趟版，这里照抄 —— 注释里自己写了 "Uses react-dom's two-phase
// accumulation pattern"。'''),
    (67, 'after', '''// `event.bubbles || isTarget` 这半个条件容易被看成冗余：
// 不冒泡的事件，target 自己总该收到吧？—— 正是这个意思，所以
// 「不冒泡」只排除**祖先**，不排除 target 本身。
//
// 顺带一个对照：onMouseEnter 声明在 Box 上，但不在 HANDLER_FOR_EVENT
// 里，也不走这里 —— 它由 hit-test.ts 的 dispatchHover 手写差值派发，
// 因为 hover 的语义是「跨节点不重发」，天然不冒泡。'''),
    (86, 'after', '''// 【三处传播语义，缺一处行为就不对】
//
//   1. stopImmediatePropagation → 立刻停，连同一节点的下一个 handler 都不叫
//   2. stopPropagation         → 只停「往祖先走」，但**同一节点的其余
//                                handler 仍然执行**
//   3. 两者都不调              → 全部跑完
//
// 第 2 条是 DOM 的真实规则，也是最容易写错的一条：直觉上「停止传播」
// 像是立刻中断，但浏览器里 target 上的两个监听者（一 capture 一 bubble）
// 都会跑。所以判据不是「停了就 break」，而是「停了 **且** 换了节点」。'''),
    (98, 'after', '''// 这一行的 `node !== previousNode` 就是上面第 2 条的实现。
// previousNode 只在上一个 handler 执行完后更新（第 112 行），
// 所以「同一节点的第二个 handler」看到的是 node === previousNode，
// 条件不成立，继续执行。'''),
    (110, 'after', '''// 一个 handler 抛错不能让整批按键丢掉。这里吞掉之后交给 logError，
// 循环继续 —— 否则「某个组件的 onKeyDown 里有个 bug」的表现会是
// 「输入框从此不响应」，排查方向会完全跑偏。
//
// 代价是：错误不再中断派发，所以一个 handler 失败后，后面的祖先
// 仍然会收到这次事件（在 DOM 里也是这么做的）。'''),
    (121, 'after', '''// ⚠️ 这张表里有三行是够不着的：
//
//   · 'click'    —— ClickEvent 不走 Dispatcher（hit-test.ts 手写冒泡）
//   · 'scroll' / 'resize' / 'mousemove' —— 全仓库没有任何一处构造这些
//                  类型的 TerminalEvent；滚动走 ScrollBox 的命令式路径，
//                  尺寸变化走 resize 监听，都不经过这里
//
// 实际只有 keydown（ink.tsx:1272）和 focus/blur（focus.ts）会被派发，
// 三者都落在 Discrete 这一档。所以整张表目前的净效果是：
// 「所有真实事件都是 Discrete」。
//
// 但这张表不是白留的 —— 它是 resolveEventPriority 的兜底，而
// reconciler 的 getCurrentUpdatePriority 反过来会先看
// currentUpdatePriority（显式设置的那个），见第 172 行。'''),
    (160, 'after', '''// 这个类自己几乎没有状态，只有三个字段，而且三个都是**给外面读的**：
//
//   currentEvent          reconciler 用它回答「现在派发的是什么事件」
//   currentUpdatePriority reconciler 拿它当 getCurrentUpdatePriority 的返回值
//   discreteUpdates       reconciler 注入进来，绕开循环 import
//
// 换句话说：Dispatcher 是 reconciler 与事件系统之间的**共享内存**，
// 不是一个「调度器」。名字有点误导。'''),
    (170, 'after', '''// NoEventPriority 是个哨兵：它的含义是「没人显式设过优先级」。
// 注意判断方向和常见写法相反 —— 不是「有事件就用事件的优先级」，
// 而是「**没有**显式优先级时才去猜事件类型」。显式设置的永远赢。'''),
    (184, 'after', '''// previousEvent 的保存/恢复（第 186、199 行）是为了支持**嵌套派发**：
// 一个 handler 里再 dispatch 另一个事件（比如 focus 变化触发 blur 再触发
// focus），内层跑完必须把外层的 currentEvent 还回去，否则 reconciler
// 会拿错事件的优先级。
//
// try/finally 而不是「跑完再赋值」：handler 抛错时也要恢复。'''),
    (197, 'after', '''// 返回值是「**没有**被 preventDefault」。
// 这个布尔值就是 Tab 键切换焦点的开关（ink.tsx:1276）：
// 任何 onKeyDown 调了 preventDefault，Tab 就不再移动焦点 ——
// 于是「自己接管 Tab」只需要一行 preventDefault，不需要别关掉什么。'''),
    (206, 'after', '''// 【为什么按键必须走 discrete（同步）】
//
// React 的默认并发模式下，状态更新会被攒起来延后处理。对按键来说这
// 是灾难：用户敲一个字符，输入框要等下一帧才显示，而终端的光标位置
// 又是每帧重算的 —— 表现就是「字打了、光标没动」或者「字出现在上一格」。
//
// discreteUpdates 让这一批更新同步 flush。代价是慢：一个按键一次重渲染。
// 所以 App.tsx 把「一批里的所有按键」塞进**同一个** discreteUpdates
// 调用（App.tsx:320），而不是每个按键调一次。'''),
    (223, 'after', '''// ⚠️ dispatchContinuous **全仓库零调用**。连带下面那条
// ContinuousEventPriority 分支也没有任何路径能走到。
//
// 它本来是给「高频、可合并」的事件准备的（滚轮、鼠标移动），
// 让 React 用较低优先级合并渲染。真实实现里这两类事件都没进
// Dispatcher：滚轮被 parse-keypress 当成 key（name 是 wheelup/
// wheeldown），鼠标移动只做 hover 命中测试，不触发 React 更新。
//
// 所以这里是第三个「扩展点建好了、需求从旁边绕过去」的例子
// （前两个：terminal-event.ts 的 _prepareForTarget、
// frame.ts 的 shouldClearScreen）。'''),
]
