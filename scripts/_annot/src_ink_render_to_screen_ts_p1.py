# -*- coding: utf-8 -*-
"""ink/render-to-screen.ts 批注：旁渲染与搜索定位（231 行全文件）。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  render-to-screen：把一段 React 元素渲染成一块独立屏幕
// ═══════════════════════════════════════════════════════════════
//
//  这是渲染器的**第二种用法**：主路径是「整棵树 → 主屏」，这里是
//  「一条消息 → 一块离屏缓冲」。目的是算出一条消息内部某个匹配在
//  第几行第几列（主屏上那条消息可能被裁剪、被滚动，位置不可靠）。
//
//  但这个文件里有三处「历史沉积」，读之前先知道：
//
//   1. `renderToScreen()` 本身**零外部读者**（只有它自己的日志提到
//      自己）。注释说「Used for search」，但现在的搜索路径
//      （`ink.tsx:1098`）只调 `scanPositions` 扫主屏，不再旁渲染。
//   2. 因此下面那套「单例 root / container / pools」的复用机制，
//      实际服务于一个没人调的函数。
//   3. `scanPositions` 和 `applySearchHighlight` 是**同一段逻辑的
//      两份拷贝**，注释里明写「Keep in sync — or extract to a shared
//      helper (TODO once both are stable)」。
//
//  活着的部分：`scanPositions`（扫主屏）、`applyPositionedHighlight`
//  （给当前匹配上色）。读的时候把注意力放这两处。'''),

(26, 'before', '''// 坐标是**消息相对**的（row 0 = 消息顶部），不是屏幕坐标。
//
// 这个设计让它能跨滚动复用：消息滚动了，匹配在消息内的位置不变，
// 上屏时只要加一个偏移。`applyPositionedHighlight` 的 `rowOffset`
// 就是这个偏移。
//
// `len` 的单位是 **cell**（格子），不是字符数 —— 因为匹配里可能有
// 宽字符。所以 `query.length` 只在纯 ASCII 时等于 `len`。'''),

(34, 'before', '''// 这段注释讲的是**为什么用 LegacyRoot**，理由比「省事」深刻：
//
//   ConcurrentRoot 的 scheduler 有一个跨 root 的待办队列
//   （`flushSyncWork` 会处理所有 root 的待办）。旁渲染每调一次就
//   建一个 root，这些 root 的待办会堆在同一个队列里互相影响 ——
//   实测是「每次调用增长 0.0003ms」，单次无感，但渲染 8000 条消息
//   就是 2.4 秒。
//
//   LegacyRoot 是纯同步的（没有 scheduler），所以没有这个泄漏。
//
// 注释还给了一个更实用的建议：**别 upfront 渲染全部**，按需单条渲染 +
// 上游按 (msg, query, width) 缓存。这一条比「修泄漏」更重要。
//
// 注意 pools 复用：样式/字符/超链接池是累积的，复用意味着后面的调用
// 命中率更高（同一个 styleId 被反复用到）。root 和 container 复用省的是
// createContainer 的约 1ms。'''),

(59, 'before', '''// ⚠️ 零外部读者。`grep renderToScreen` 只有本文件内的两处命中
// （定义 + 日志字符串）。
//
// 它的设计仍然值得读，因为它是「如何在一个进程里跑第二棵 React 树」
// 的完整示例：
//
//   建 root（自己挂 FocusManager，dispatch 直接返回 false —— 旁渲染不需要焦点）
//   → createContainer(LegacyRoot, ...)
//   → updateContainerSync(el) + flushSyncWork()  ← React 侧同步跑完
//   → 手动 calculateLayout(width)
//   → createScreen(width, max(1, height))
//   → renderNodeToOutput
//   → output.get()      ← **必须有这一步**
//   → updateContainerSync(null) + flushSyncWork()  ← 卸载，但保留 root
//
// 其中 `output.get()` 那一步最容易漏：`renderNodeToOutput` 只是把写操作
// **排队**进 Output，`.get()` 才把它们真正落进 Screen 的格子数组。
// 少了它，screen 是全零（构造时零填充），看起来像「渲染不出东西」。'''),

(99, 'before', '''// `Math.max(1, height)` —— createScreen 不接受 0 高。
//
// 但注释写的是「createScreen may choke」，实际后果取决于实现：如果
// 它内部 `new Int32Array(w * 0)`，那是个合法空数组，不会抛错，
// 只是后面任何写入都会越界。所以这里宁可给 1 行。
//
// 空树（`height === 0`）是合法输入 —— 调用方可能在消息还没内容时调它。'''),

(149, 'before', '''// 扫主屏找匹配。返回值是**缓冲相对**坐标（row 0 = 缓冲顶部），
// 因为主屏的缓冲就是「当前这一屏」。
//
// 三处跳过条件跟 `applySearchHighlight` 完全一致（SpacerTail /
// SpacerHead / noSelect）—— 这不是巧合，是必须：扫描时说「这里有个
// 匹配」而上色时说「这个格子不能改」，用户就会看到「找到了但没高亮」。
//
// 所以这两份实现的生命线是**同步**。注释里那个 TODO 一直没做，
// 意味着每次改跳过条件都要改两处。'''),

(160, 'before', '''// 这三行是为下面那个映射表做准备，而映射表存在的唯一理由是：
// **小写化会改变 code unit 数**。
//
// 两个例子：
//   · emoji 的代理对：`text.length` 是 2，但在屏幕上占 1 个 cell
//   · 土耳其语 İ（U+0130）：`toLowerCase()` 变成 `i` + U+0307 两个 code unit
//
// 于是 `text.indexOf(q)` 得到的位置**不能当成 cell 下标**用。
// `codeUnitToCell` 就是那张翻译表：第 i 个 code unit → 第几个 cell。
//
// 注意小写化是**逐字符**做的（第 179 行 `cell.char.toLowerCase()`），
// 不是对拼好的整串做 —— 对整串做的话，映射表就跟不上了。这一条
// applySearchHighlight 里注释得更详细。'''),

(188, 'before', '''// 非重叠前进（`pos + qlen`），不是 `pos + 1`。
//
// 区别在 `'aaa'` 里搜 `'aa'`：
//   重叠前进（pos+1）→ 位置 0 和 1 都算匹配，格子 1 被反显两次
//   非重叠（pos+qlen）→ 只有位置 0
//
// 这也是 less / vim / grep / Ctrl+F 的行为。两次反显虽然幂等
// （`withInverse` 应用两次等于一次），但会浪费一遍循环，而且
// 计数会翻倍（影响「1/3」这种提示）。'''),

(198, 'before', '''// 扫描耗时单独记账，每 20 次调用打一行日志。
//
// 这段计时代码是「性能埋点写在业务函数里」的典型 —— 好处是零侵入
// （不用改调用链），坏处是每次都要判 `calls % 20`。在扫一屏
// （几十行 × 每行几十格）的量级下，这个判断的开销可以忽略。
//
// 但注意 `timing.scan` 只有这里在加，`timing.reconcile` / `yoga` /
// `paint` 都在 renderToScreen 里加 —— 而 renderToScreen 零读者，
// 所以那三个数永远是 0。日志里的 `scan=xx ms` 是唯一有意义的字段。'''),

(212, 'before', '''// 给「当前匹配」上色（黄 + 粗 + 下划线），其余匹配的反显由
// `applySearchHighlight` 负责。两层叠加的设计注释讲得很清楚：
//
//   扫描层 = 「你可以去这里」（反显，所有可见匹配）
//   定位层 = 「你现在在这里」（黄底，只有当前那个）
//
// 为什么不在这里也画反显：`withInverse` 幂等，画了等于白画。
//
// ⚠️ 一个隐含前提：这条路径假设 `rowOffset` 给的偏移是**本帧的**。
// 如果消息刚滚动、rowOffset 还是上一帧的值，高亮就会落在错行 ——
// 而且只落错一行，看起来像「高亮稍微偏了一点」，不容易第一时间
// 归因到滚动。'''),

(219, 'before', '''// 两个越界判断，语义不同：
//   第一个 `currentIdx` 越界 → 说明「当前匹配」被删了（查询变了或
//                              结果集变了），静默返回 false
//   第二个 `row` 越界     → 匹配在可视区外（滚走了），也返回 false
//
// 返回 false 表示「没画」，调用方据此决定要不要重绘 —— 所以这两种
// 「没画」都必须返回 false，不能装作画了。'''),
]
