# -*- coding: utf-8 -*-
"""ink/renderer.ts 批注：DOM → 屏幕缓冲（178 行全文件）。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  renderer：一帧的「画」
// ═══════════════════════════════════════════════════════════════
//
//  这个文件短，但它是所有「为什么这帧长这样」问题的汇合点。
//  它做的事：拿 yoga 算好的尺寸 → 建/复用屏幕缓冲 → 调一次
//  `renderNodeToOutput` → 回收 ScrollBox 的排水标记 → 返回 Frame。
//
//  两个参数值得先明白：
//
//  `frontFrame`  = 上一帧（要拿它的 screen 做 blit 基准）
//  `backFrame`   = 本帧的屏幕缓冲（可能已被预分配，也可能没有）
//
//  为什么是「传入 backFrame」而不是「每次新建」：ScrollBox 的滚动需要
//  「本帧的缓冲已经存在且尺寸对」，否则滚动位移就无处可比。'''),

(35, 'before', '''// Output 跨帧复用。这里省的不是分配开销，而是 `charCache` ——
// 「一行字符串 → ClusteredChar 数组」的缓存。分词 + 字素聚类 +
// 样式合并是全链路最贵的一步，而**大部分行在相邻两帧里根本不变**
// （流式输出只有最后一行在长）。复用 Output 就让这些行直接命中缓存。'''),

(41, 'before', '''// 注意 pools 是**从 backScreen 上读的**，不是闭包捕获的。
//
// 理由注释里写了：池会被「换代重置」替换（StylePool 到某个阈值会
// 整体换新，避免 id 溢出）。闭包捕获的话，换代之后这一帧还在用旧池，
// 生成的 styleId 在新池里指向别的样式 —— 屏幕上会出现莫名其妙的颜色。
//
// 一个通用教训：**缓存句柄不要跨「缓存被重置」的边界持有**。'''),

(52, 'before', '''// 这里在防 yoga 的「未初始化」和「无效值」两种状态。
//
// `getComputedHeight()` 在 `calculateLayout()` 之前返回 NaN —— 这是
// yoga 的约定（不是 undefined，也不是 0）。而 NaN 会一路传到
// `new Int32Array(w * NaN)` 变成 RangeError。
//
// 所以判据是三重：undefined（没有 yogaNode）、!isFinite（NaN / Infinity）、
// < 0（负值）。少一个都会漏。'''),

(63, 'before', '''// 无效就返回「0 高屏」而不是抛错 —— TUI 不该因为一次布局异常整屏崩掉。
// 0 高屏在下一帧的 diff 里表现为「内容变没了」，用户看到的是闪一下，
// 而不是退出。
//
// 但代价是这个错误**默认不可见**：`logForDebugging` 只在 `--debug`
// 下才输出。所以第 65 行那个 if 其实是「只在有 yogaNode 但尺寸无效时
// 才记日志」—— 完全没 yogaNode 是最常见的情况（空树），不值得记。'''),

(84, 'before', '''// 向下取整。yoga 的尺寸可能是小数（百分比、flex 分配），而屏幕格子
// 只能是整数。取整方向选 floor 而不是 round：多出来的半格宁可不要，
// 也别指望终端能画半格。'''),

(86, 'before', '''// 这段是整份文件最值得读的注释 —— 它记录了一个真实的、跨模块的
// 不变量破坏，以及**为什么选择「钳制」而不是「报错」**。
//
//  不变量：alt-screen 的屏幕缓冲高度 == terminalRows。
//  破坏方式：有东西渲染在 `<AlternateScreen>` 那个 Box **外面**
//           （真实案例：MessageSelector 被放到了 `<FullscreenLayout>` 外）。
//  破坏后果：三个下游假设同时失效 ——
//      · renderer 自己的 viewport +1 hack
//      · cursor.y 的钳制
//      · log-update 的 `heightDelta === 0` 快路径
//    三者一起失效 → 虚拟光标和物理光标失步 → 整屏错乱。
//
//  处理方式：`height = terminalRows`（忽略 yoga 说的更高值）。
//  于是溢出的写入落在 `y >= screen.height`，被 `setCellAt` 丢掉。
//  结果是「那个兄弟节点看不见」，而不是「整屏崩」。
//
//  这是一个可以复用的决策模式：**面对已破坏的不变量，选一个失败
//  范围最小的降级方向**。这里选了「局部不可见」（明显、好查），
//  放弃了「全屏正确」（做不到）。'''),

(97, 'after', '''// 注意 `yogaHeight > terminalRows` 才记日志，不是 `!==`。
// 小于也意味着有问题（内容没填满 alt-screen 通常无害），但噪音太大 ——
// 合法的「内容比屏幕短」场景很多。'''),

(105, 'before', '''// `backScreen ?? createScreen(...)`：本帧的缓冲可能已经被上游预分配
// （ScrollBox 的滚动需要它），没有才新建。
//
// 有的话走 `output.reset(width, height, screen)` —— 注意 reset 不只是
// 设尺寸，还要把 Output 的操作队列和 damage 状态清干净。'''),

(114, 'before', '''// 三个全局标记在每帧开头清零：布局位移、滚动提示、排水节点。
//
// 它们都是「上一帧的 renderNodeToOutput 塞进模块级变量、本帧来取」的
// 单向传递 —— 取完必须清，否则下一帧会拿到上一帧的残留。
//
// 这种「模块级变量当返回值用」的写法在渲染热路径里很常见（省一次
// 对象分配），代价是可重入性：**同一帧内不能渲染两棵树**。'''),

(118, 'before', '''// `prevFrameContaminated` 的四个来源全在这段注释里：
//   1. 选区覆盖层在 ink.tsx 里改了返回的缓冲（反显格子）
//   2. `resetFramesForAltScreen()` 把缓冲换成了空白
//   3. `forceRedraw()` 把缓冲重置成 0×0
//   4. **删除绝对定位节点**（第 129 行单独判，见下）
//
// 这四种都让「从 prevScreen blit」变得不安全：会复制到过期的反显格子、
// 空白、或者什么都没有。反过来，干净的时候 blit 能把稳定态帧
// （spinner 跳动、文本流式追加）恢复成 O(未变) —— 这是这个渲染器
// 能跑到 60fps 的根本原因。
//
// 注意第 4 种为什么要单独判：
// 绝对定位的节点可能**画在了非兄弟节点上面**（比如一个覆盖层压在
// 树序更早的 ScrollBox 上）。删掉它之后，那个 ScrollBox 从 prevScreen
// blit 回来的像素里**还带着覆盖层的痕迹**。而 `hasRemovedChild` 只
// 能护住直接兄弟，护不住跨子树的情况。'''),

(129, 'before', '''// `consumeAbsoluteRemovedFlag()` —— 名字里的 consume 指出了它的语义：
// 读一次就清。所以这个标志的寿命是「从 addPendingClear 到下一帧的
// 这一行」，用完即焚。
//
// 也正因为是「读一次就清」，它不能在同一帧里被问两次。'''),

(143, 'before', '''// 排水（drain）：ScrollBox 一帧只能滚一段（受限于渲染预算），
// 剩下的 `pendingScrollDelta` 要在下一帧继续。
//
// 但 `renderNodeToOutput` 结尾会 **clear 掉 scrollbox 的 dirty 标记**，
// 于是下一帧的根节点 blit 会认为这棵子树没变、直接跳过 —— 滚动就停了。
//
// 所以这里在 render **之后** 补一个 `markDirty(drainNode)`。
// 注释里那句「Done AFTER render so the clear-dirty at the end of
// renderNodeToOutput doesn't overwrite this」是这条顺序契约的全部理由：
// **顺序反了，标记就被清掉了，而且是静默的 —— 只是滚动卡住**。'''),

(150, 'before', '''// 返回 Frame。三处细节：
//
//  **viewport.height = rows + 1（alt-screen）**。这个 +1 的原始理由
//  是绕开 `shouldClearScreen()` 的 `screen.height >= viewport.height`
//  判断 —— 但那个函数**已经零读者了**（见 frame.ts:105 的批注）。
//  现在真正生效的是 `log-update.ts` 第 205 行和第 222 行的同形判断：
//  `prev.screen.height >= prev.viewport.height`。+1 让这个不等式为假，
//  目的没变，只是**注释指向了一个已经死掉的函数**。
//
//  这是一处典型的「注释漂移」：代码有效、理由正确、指针失效。
//  读代码时如果发现注释引用的符号查不到调用方，先别怀疑自己 ——
//  很可能是搬运时留下的旧路标。
//
//  **cursor.y 的钳制**。alt-screen 下必须落在 `[0, rows-1]`：
//  如果 y == screen.height（== rows），log-update 的光标恢复会在
//  最后一行发一个 LF，alt buffer 就往上滚一行 —— 屏幕永久差一行。
//
//  **visible**：只有 TTY 且有内容时才显示光标。`screen.height === 0`
//  也隐藏 —— 没内容就没有「光标该在哪」这回事。'''),
]
