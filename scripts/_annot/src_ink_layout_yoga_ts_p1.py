# -*- coding: utf-8 -*-
"""ink/layout/yoga.ts 批注：yoga 适配层（308 行全文件）。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  yoga：308 行，没有一行有逻辑
// ═══════════════════════════════════════════════════════════════
//
//  这是一份纯粹的适配代码：把 `LayoutNode` 的 52 个方法逐个转发给
//  yoga，中间只做两件事 ——
//
//    1. 字符串枚举 → yoga 的数值枚举（`'flex-start'` → `Align.FlexStart`）
//    2. edge/gutter 的名字 → yoga 的 Edge/Gutter
//
//  读这种文件的方法是**别读**：它是机械的。唯一值得看的是三处
//  「没有完全转发、悄悄做了取舍」的地方：
//
//    · `calculateLayout` 忽略了 height 参数（第 82 行）
//    · `calculateLayout` 硬编码了 `Direction.LTR`（第 83 行）
//    · `getParent` 每次新建一个 wrapper（第 75 行）
//
//  下面逐个说。
//
//  ── 先交代一个版本信息 ──
//
//  第一行 import 的 `src/native-ts/yoga-layout/index.js` 是**纯
//  TypeScript 移植版**的 yoga，不是 WASM。第 302 行那段注释说得很清楚：
//  TS 版是同步的，没有 WASM 加载、没有线性内存增长，所以
//  「预加载 / 换实例 / 重置」那一整套机制全都不需要了。
//  `root.ts:107` 那个 `await Promise.resolve()` 就是这套机制撤掉之后
//  留下的痕迹。
//
//  换成纯 TS 的收益：启动更快、没有 WASM 边界开销、可以精确调试。
//  代价：`free()` 变成可选的（GC 会处理），但接口还留着。'''),

(33, 'before', '''// 九项 edge 映射。这是整个文件唯一「有信息量」的常量 ——
//  因为它明确了 `horizontal` / `vertical` / `all` 三个组合边在
//  yoga 里是**真的存在**的枚举值（不是自己拼的）。
//
//  这一点跟 CSS 不一样：CSS 没有 `border-horizontal`，只有四条边。
//  yoga 有组合边，是因为它在内部按「四个方向整体处理」比按边处理快。'''),

(63, 'before', '''// 薄转发。注意 `(child as YogaLayoutNode).yoga` —— 类型断言是必须的：
//  接口只保证「是个 LayoutNode」，而实际传进来的必然是 YogaLayoutNode
//  （因为只有这一个实现）。
//
//  代价：如果有人实现了第二个 LayoutNode（比如测试用的假节点）并把它
//  塞进这棵树，这里会**静默拿到 undefined** 然后 yoga 那边报一个
//  难以理解的错误。所以这个适配层实际上是「单实现」的 ——
//  接口是名义上的抽象。'''),

(75, 'before', '''// `getParent()` 每次调用都 `new YogaLayoutNode(p)` —— 于是
//
//     node.getParent() === node.getParent()   // false
//
//  **身份不相等**。这是一个容易踩的坑：任何想用 `===` 比较父节点的
//  代码都会失败。
//
//  好在调用方都只读属性、不做比较。而改成「缓存 wrapper」会引入
//  另一个问题（弱引用管理），所以这个「每次新建」是有意的简化。
//
//  通用教训：**适配层返回的对象，默认不该被当作身份使用**。'''),

(82, 'before', '''// ⚠️ 两个刻意的取舍，都在这三行里：
//
//  **1. height 参数被忽略**（`_height`，下划线前缀表示「故意不用」）。
//     布局只由宽度驱动 —— 因为这是终端：高度是**结果**不是**输入**。
//     内容多高就是多高，屏幕不够就滚动或裁剪。所以永远传 `undefined`
//     让 yoga 自己算。
//
//     （对比 CSS：height 是输入，可以约束。终端里没有「固定高度的
//     容器内滚动」这种自然语义，ScrollBox 是靠裁剪 + 位移模拟的。）
//
//  **2. `Direction.LTR` 硬编码**。
//     整个布局树永远是 LTR 的 —— 于是 RTL 文本的**布局**（换行位置、
//     对齐）是按 LTR 算的，只有**字符顺序**在 bidi.ts 里重排。
//
//     这个简化的后果：阿拉伯语的段落对齐会偏左（而不是右）。
//     对 TUI 来说可接受 —— 但这是一个已知的不完整之处，bidi.ts 的
//     结尾批注里提过同一类取舍。'''),

(87, 'before', '''// measure 回调的转接。yoga 用的是数值枚举（MeasureMode），
//  这里翻译成字符串三态。
//
//  注意用 `fn(w, mode)` 而**没有** drop 掉 `wMode` 为 Undefined 的情况 ——
//  三态全都传下去了。这是对的：`dom.ts` 的 measureTextNode 需要知道
//  当前是「无约束」还是「有上限」，因为两者对折行的处理不同。'''),

(124, 'before', '''// 六个 computed 读取方法。它们共同的前提是**布局已经算过** ——
//  在 `calculateLayout()` 之前调，yoga 返回 NaN（不是 0）。
//
//  这是整个渲染器里最容易踩的坑之一：
//    · `renderer.ts:52` 用 `!Number.isFinite()` 三重防御
//    · `measure-element.ts` 用 `?? 0` 兜（但 NaN 不会被 ?? 兜住 ——
//      这是一个潜在的疏漏：NaN 是 number，`??` 不拦它）
//
//  所以「NaN 而不是 0」这个设计是危险的：它要求每个读者都主动检查。'''),

(177, 'before', '''// 从这里开始是一长串 setter。它们的共同点：**map 在方法内部构造**。
//
//      setFlexDirection(dir) {
//        const map = { row: ..., ... }   ← 每次调用新建一个对象
//        this.yoga.setFlexDirection(map[dir])
//      }
//
//  这在热路径上是浪费的（对象字面量 + 属性查找），但很轻微 ——
//  样式 setter 只在 `setStyle` 里被调，而 `setStyle` 是按值比较的
//  （值没变就不调）。所以稳定态下几乎不执行。
//
//  对比 `EDGE_MAP` / `GUTTER_MAP` 是**模块级常量** —— 因为它们
//  在 `setPosition` / `setMargin` 里被调得更频繁（每个节点都要设边距）。
//
//  这个不一致不是最优解，但也不值得改：函数内 map 的可读性更好
//  （类型紧挨着使用处）。'''),

(291, 'before', '''// 生命周期。在纯 TS 实现里这两个方法是 no-op 或者接近 no-op，
//  但接口保留 —— 见 node.ts:149 的批注。
//
//  值得记的是 `freeRecursive()`：它会递归释放整棵子树。而在 WASM 版里，
//  先 free 父节点再 free 子节点会 use-after-free。所以 `reconciler.ts`
//  里那段三步顺序（先 removeChild 再 free）不是风格问题。'''),

(299, 'before', '''// 这段注释是这份文件的**历史档案**，比代码本身有价值：
//
//    「The TS yoga-layout port is synchronous — no WASM loading,
//     no linear memory growth, so no preload/swap/reset machinery
//     is needed. The Yoga instance is just a plain JS object
//     available at import time.」
//
//  它记录了从 WASM 版换到 TS 版之后，**哪些机制被删掉了**：
//
//    · 预加载（preload）—— WASM 要 await
//    · 换实例（swap）   —— 线性内存增长时要重建（旧实例的指针全失效）
//    · 重置（reset）    —— 同上，重建之后要把所有节点重新挂一遍
//
//  这三样东西在旧版里占了相当多代码，而且是很多「诡异 bug」的来源
//  （内存增长导致所有 yogaNode 句柄失效，但 JS 侧还以为有效）。
//
//  识别这类「大简化」的痕迹很有用：如果你在别处看到 `await loadYoga()`
//  或者「yoga 重置」之类的逻辑，那说明那部分代码是 WASM 时代的遗产。'''),
]
