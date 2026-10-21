# -*- coding: utf-8 -*-
"""ink/styles.ts 批注：样式类型 + yoga 属性映射（1-771）。"""

ANNOTATIONS = [
(14, 'before', '''// ═══════════════════════════════════════════════════════════════
//  样式层：从 CSS 风格的 props 到 yoga 指令
// ═══════════════════════════════════════════════════════════════
//
//   这个文件只有两件事：
//     ① 定义两套类型（TextStyles 管字，Styles 管盒子）—— 上半 390 行
//     ② 把 Styles 逐项翻译成 yoga 的 setter —— 下半 380 行
//
// 【为什么两套类型要分开】
//   TextStyles 影响的是「字符怎么画」（颜色、粗体、下划线），
//   最终变成 SGR 转义序列，交给 colorize.ts。
//   Styles 影响的是「盒子怎么摆」（宽高、padding、flex），
//   最终变成 yoga 节点上的数字，交给布局引擎。
//   两者的消费方完全不同，混成一个类型会让「这个属性到底谁在用」
//   永远说不清。
//
// 【上层 390 行为什么不能删】
//   里面的英文注释是从 CSS 文档搬来的定义（flex-grow、justify-content
//   这些概念在终端里和在浏览器里语义一致）。删掉这些注释，
//   读者就得去查 CSS 规范。这是本项目里少见的「注释密度高于代码价值」
//   的文件 —— 但保留了是对的。'''),

(15, 'before', '''// 四种颜色写法，都不是自由字符串而是**模板字面量类型**：
//     rgb(215,119,87)   真彩色（24 位）
//     #d77957           十六进制，等价于上面那行
//     ansi256(174)      256 色索引
//     ansi:red          16 色具名，带 `ansi:` 前缀
//
//   用模板字面量类型而不是 string，好处是编译期就能拦住 rgb(300,0,0)
//   之外的拼写错误。坏处是运行时仍然要正则校验（见 colorize.ts 里的
//   RGB_REGEX）—— 类型只在编译后消失，而颜色值可能来自配置文件。
//
//   `ansi:` 这个前缀不是终端语法，是这个项目自己加的：
//   用来区分「16 色具名」和「十六进制色」。写 #ff0000 是 24 位真彩，
//   写 ansi:red 是终端调色板第 1 号 —— 在很多深色主题下这两个颜色
//   差别很大，而前者会被 tmux 降级（见 colorize.ts）。'''),

(44, 'before', '''// TextStyles：**只有字，没有盒子**。八项，对应 SGR 的三类：
//     颜色类  color / backgroundColor
//     强度类  bold / dim（这两个在终端里常常互斥，见 Ansi.tsx 的 StyledText）
//     装饰类  italic / underline / strikethrough / inverse
//
//   注意这里没有 fontSize、lineHeight、letterSpacing —— 终端没有这些概念。
//   字体是用户的，行高由终端决定，字距不存在。
//   「终端 UI 的样式系统本质上只有颜色和开关」。'''),

(55, 'before', '''// Styles：盒子。这个类型有 60 多个可选字段，看着吓人，
//   但结构很规整 —— 下面 350 行英文注释把它们按 CSS 概念分好了组：
//     方向与定位（position / top / bottom / left / right）
//     间距（margin / padding 各有 7 个变体）
//     弹性（flexGrow / flexShrink / flexDirection / flexBasis / flexWrap）
//     对齐（alignItems / alignSelf / justifyContent）
//     尺寸（width / height / minX / maxX，每个都是 number 或百分比字符串）
//     边框（borderStyle + 四条边 + 四色 + 四 dim）
//     其它（display / overflow / opaque / noSelect）
//
//   `readonly` 全部加上了。这不是装饰 —— dom.ts 里 setStyle 用
//   **按值比较**来判断「样式变没变」，如果调用方可以原地改 style 对象，
//   比较就会永远得到「没变」，脏标记不触发，屏幕不更新。
//   readonly 是在类型层面把这条约束钉死。'''),

(406, 'before', '''// 从这里开始是翻译层。九个 apply 函数，每个负责一组属性。
//
// 【最重要的一个约定：`'x' in style` 而不是 `style.x !== undefined`】
//
//   这个 style 参数**不是全量样式**，是 diff。来源在 reconciler.ts 433 行：
//       const style = diff(oldProps.style, newProps.style)
//   而 diff 的实现（同文件 62 行起）有一条关键行为：
//       for (const key of Object.keys(before)) {
//         if (!Object.hasOwn(after, key)) changed[key] = undefined
//       }
//   也就是说，「上一帧有 margin、这一帧没写」这件事在 diff 里变成
//   `{ margin: undefined }` —— **键在，值是 undefined**。
//
//   于是两种写法的语义差别就出来了：
//     'margin' in style          → 「这个键这一帧**变了**」（含被删除、被重置）
//     style.margin !== undefined → 「margin 有新值」
//
//   前者为 true 而后者为 false 的情况，正是「属性被移除」。
//   按后者判断的话，「把 margin 从 4 改回不设置」这个操作永远无法表达 ——
//   屏幕会一直保留 4 格边距。这是这套代码里最容易读错、也最容易写错的地方。
//
//   约定：**值 undefined 表示「重置成默认」**，不是「不要动」。
//   真正「不要动」的表现形式是「这个键根本不在 diff 里」。
//
//   代价：每个 apply 函数里都要写 `'x' in style` 加 `?? 0` 的组合，
//   比 `if (style.margin != null)` 啰嗦。这是「用语法细节表达语义」
//   的典型案例。'''),

(420, 'before', '''// position 的四个边。三态处理：
//     string（"50%"）→ setPositionPercent
//     number         → setPosition
//     其它（undefined）→ setPosition(edge, NaN)
//
//   NaN 在这里是「未设置」的哨兵值 —— yoga 内部就是用它表示
//   YGValueUndefined。不能用 0 代替：0 是「贴着边」，语义完全不同。
//   走到那个分支的唯一途径是「这个键变了、但新值是 undefined」，
//   也就是上游把 top 删掉了 —— 此时重置成「未设置」才是对的。
//
//   百分比解析用 Number.parseInt，没有校验。`"50%"` 得到 50，
//   `"auto"` 得到 NaN（于是变成「未设置」），`"50.5%"` 得到 50（截断）。
//   宽松解析的后果是「写错了不报错，只是布局奇怪」——
//   这也是终端 UI 调试常见的困惑来源。'''),

(434, 'before', '''// overflow 的降维：yoga 只有一个 overflow 开关，而这个 API 有 x/y 两轴。
//
//   处理方式是**取并集，且 scroll 优先于 hidden**：
//     overflowY=hidden + overflowX=scroll → Scroll
//
//   为什么可以这么粗暴：在布局阶段，`hidden` 和 `scroll` 的效果**完全一样**
//   （都阻止子节点把容器撑大）。两者的区别只在渲染阶段 ——
//   `scroll` 额外告诉 render-node-to-output「要应用 scrollTop 平移」。
//   所以布局层只需要知道「会不会被撑开」这一个比特。
//
//   最后那个 else-if 是「重置」分支：三个键里只要有一个出现了（哪怕值是
//   undefined，见 406 那段），就把 yoga 明确设回 Visible。
//   它和「三个键都没出现」是两件事 —— 后者表示这个节点从没设过 overflow，
//   yoga 的默认状态本来就不必动；前者表示「刚刚被删掉了」，必须显式复位。'''),

(454, 'before', '''// margin 七个变体。注意 `?? 0` 和 `|| 0` 混用：
//     margin / marginX / marginY 用 `?? 0`
//     marginLeft / Right / Top / Bottom 用 `|| 0`
//
//   对 undefined 两者结果相同，唯一的差别是 NaN：`NaN ?? 0` = NaN，
//   `NaN || 0` = 0。所以后者会把 NaN 静默归零，前者会把 NaN 传给 yoga
//   （yoga 里 NaN 也表示未定义，等价于 0）。
//   行为上无害，但风格不统一 —— 这类混用是「分几次写的」留下的痕迹，
//   不是有意为之。'''),

(514, 'before', '''// flex 系列。这一段有 14 个 if，形式高度重复，值得说的只有两处：
//
//   · **每个枚举都是若干独立的 if，不是 switch 或映射表。**
//     好处是非法值（拼错的 'row-revese'）会被静默忽略，
//     不会 fall through 到某个分支。
//     坏处是新增一个枚举值要记得在这堆 if 里加一条 —— 类型系统
//     不会提醒你（因为条件里没有 else 分支）。
//
//   · flexShrink 的默认值是 1，而 flexGrow 是 0。这是 CSS 的原语义：
//     默认会收缩（装不下就挤），但不会增长（有空间也不占）。
//     写反了会让所有「撑满剩余空间」的布局失效。'''),

(557, 'before', '''// flexBasis 三态，和 position 一样：
//     number → setFlexBasis
//     string → setFlexBasisPercent（parseInt 取数字部分）
//     其它   → setFlexBasis(NaN) 表示「用 width」
//
//   注意这个分支里没有 `??` 兜底 —— 走到 else 就是「undefined 或 null」，
//   统一给 NaN。NaN 在 yoga 里的含义是「这个维度不指定」，
//   于是 flex 布局会回退到按内容测量。'''),

(630, 'before', '''// 尺寸。六个属性各三态（number / 百分比字符串 / undefined），
//   形式与 flexBasis 完全一样，但有两个细节不同：
//
//   · width / height 的 undefined 走的是 **setWidthAuto / setHeightAuto**，
//     不是 NaN。auto 和 undefined 在 flex 布局里语义不同：
//     auto 表示「按内容算」，undefined 表示「不指定」（由父级决定）。
//   · min / max 是四个属性但只有两种处理（百分比 / 数值），
//     没有 auto 那一档 —— CSS 里 min-width 本来就没有 auto。
//
//   统共 6 个属性 × 3 种情况 = 18 个分支，全是手写的。
//   这个文件的价值不在巧妙，在**把 CSS 的边界情况一条不漏地摆出来**。'''),

(684, 'before', '''// display 只有两个值。CSS 有十几个（grid、table、inline-flex…），
//   终端里只需要「在不在流里」。`none` 的节点完全不参与布局，
//   尺寸为 0，也就不会被绘制 —— 这一条是 render-node-to-output 里
//   那堆 blit 判定的前提。'''),

(692, 'before', '''// 边框。这是全文件唯一一个需要**第二个参数**的 apply 函数，
//   原因值得说清楚。
//
//   问题：setStyle 收到的是增量 diff。假设上一帧是这样：
//       borderStyle: 'single', borderTop: false
//   这一帧只改了一个属性，diff 里是：
//       { borderStyle: 'double' }
//   那么仅凭 diff，我们不知道该给 top 边设多宽 —— diff 里没有 borderTop。
//
//   解决办法：把**新一帧的完整样式**也传进来。调用点是 reconciler.ts 457 行：
//       applyStyles(node.yogaNode, style /* diff */, newProps.style /* 全量 */)
//   diff 里出现 borderStyle 时，用全量里的四条边开关去决定每边宽度。
//   这就是 701 行 `resolvedStyle ?? style` 的作用。
//
//   注意它拿的是 **newProps**（新值）而不是 oldProps —— 要的是「这一帧想
//   长什么样」。另一个调用路径（reconciler.ts 127 行，首次挂载）只传两个
//   参数，此时 style 本身就是全量，resolvedStyle 缺省等于 style。
//
// 【极性为什么是 `!== false` 而不是 `=== true`】
//   因为默认值。`borderTop` 的默认是 true（见 259 行的 @default true），
//   所以「没写」= 显示，「写 false」= 隐藏。
//   如果判据写成 `=== true`，那么只写 borderStyle 不写 borderTop 的人
//   会得到「四条边全是 0 宽」—— 边框样式设了但看不见，排查起来很费时。
//
//   「默认值决定极性」这条规律在这里和 mcp/config.ts 的白黑名单
//   是同一个道理：**判据的方向必须跟着默认值走。**'''),

(741, 'before', '''// gap 三个变体，形式与 margin 一致。gap 在终端布局里的典型用途是
//   表格列间距、列表项间距 —— 它比给每个子节点加 margin 更不容易出错，
//   因为不会在首尾多出一格。'''),

(755, 'before', '''// 总入口。九个 apply 按固定顺序调用。
//
//   顺序在这里**不影响结果** —— 每个函数只写自己那组 yoga 属性，
//   互不交叉。但固定成一种顺序有实际价值：
//   调试时可以把 yoga 节点的最终状态按同样的顺序读一遍。
//
//   另一个观察：这里没有「先 diff 再应用」的优化。每个 apply 内部
//   都靠 `'x' in style` 过滤，所以真正落到 yoga setter 的调用
//   只对应实际变化的属性。省下的是 yoga 内部的脏标记 ——
//   重复 set 同一个值不会让 yoga 重算（它自己按值比较）。
//   所以这一层的成本主要是函数调用开销，不是布局重算。'''),
]
