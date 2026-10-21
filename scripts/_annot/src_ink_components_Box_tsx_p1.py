# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ⚠️ 这是 **React Compiler 的产物**，不是人写的组件。
//
//   _c(42)            申请 42 个 memo 缓存槽（$[0] … $[41]）
//   if ($[0] !== t0)  输入没变就整段跳过，直接从 $ 槽里取上次的结果
//   t1 … t18          展开后的临时变量，原名是 children/style/onClick…
//
// 读这种代码的正确姿势：**先还原成原始 JSX**，再读逻辑。
// 这段代码的原始版本大约 40 行：
//
//   function Box({children, ref, tabIndex, autoFocus, onClick, …,
//                flexWrap = 'nowrap', flexDirection = 'row',
//                flexGrow = 0, flexShrink = 1, ...style}) {
//     warn.ifNotInteger(style.margin, 'margin')  // …共 16 次
//     return <ink-box … style={{flexWrap, flexDirection, flexGrow,
//                               flexShrink, ...style,
//                               overflowX, overflowY}}>{children}</ink-box>
//   }
//
// （Ansi.tsx 那批批注里讲过同一套记号，这里只补 Box 特有的部分。）'''),
    (46, 'after', '''// `Except<Styles, 'textWrap'>` —— 把 textWrap 从 Props 里**删掉**，
// 不是因为 Box 不支持它，而是因为「折行/截断」是 Text 的语义：
//
//   Text   有子文本节点，折行时要知道在哪断
//   Box    只是容器，自己没有内容可折
//
// 允许 Box 传 textWrap 的后果是「传了但没效果」，比编译期报错糟糕得多。
// 同一份 styles.ts 里 textWrap 是 Styles 的字段（所以 ScrollBox 又把它
// 排除了第二遍），说明这个「谁的字段」的边界是靠 Except 手工划的。'''),
    (106, 'after', '''// 【默认值区：和 CSS flexbox 对齐】
//
//   flexDirection 'row'       CSS 默认 row（不是 column —— 这是新人最常
//                             记错的一条，ink 这里跟 CSS 走）
//   flexWrap      'nowrap'    CSS 默认 nowrap
//   flexGrow      0           CSS 默认 0
//   flexShrink    1           CSS 默认 1
//
// 四个默认值全对齐 CSS，一个都没改。好处是从网页转过来的人不用重学；
// 代价是终端里「列布局」比网页更常见（聊天记录、列表），所以
// ink 的调用方几乎每处都要显式写 flexDirection="column"。'''),
    (110, 'after', '''// 【16 次 ifNotInteger，全在这个 memo 分支里】
//
// 它们检查的是「间距类属性必须是整数」—— 因为终端没有半个格子，
// margin 0.5 只能四舍五入，而四舍五入是**静默**的（yoga 里是 DP
// 单位，0.5 真会变成小数，最后取整时丢一位）。
//
// 但注意位置：这一整段只在 `$[0] !== t0`（props 引用变了）时才跑。
// 所以「父组件把 props 对象 memo 住」时，这些警告一次都不会打。
// 对警告来说这个行为可以接受（第一次渲染总会检查），但如果把它
// 当成「校验」用，就会误判。
//
// 另一件事：这 16 行是**手工列举**的。新增一个间距属性（比如 inset）
// 必须记得加一行，没有「遍历所有 Styles 里以 margin/padding 开头的键」
// 这种自动做法。'''),
    (166, 'after', '''// 三级回退：`overflowX ?? overflow ?? 'visible'`。
//
// 顺序是「具体 → 通用 → 默认」。所以同时写 overflow 和 overflowX 时，
// 更具体的那个赢。这和 CSS 的 shorthand 展开规则一致。
//
// 为什么要在这个组件里做而不是交给 yoga：yoga 只认 overflowX/overflowY
// 两个轴，没有 shorthand。这层归一化必须有人做，Box 是唯一必经之路。'''),
    (192, 'after', '''// `<ink-box>` 是 **host 组件**（reconciler 的 createInstance 认的就是
// 这个名字，见 reconciler.ts）。所以这里不是「渲染一个叫 ink-box 的
// React 组件」，而是「向 reconciler 要一个 ink-box 类型的 DOM 节点」。
//
// style 的展开顺序：显式的四个 flex 值在前，`...style` 在后 ——
// 后展开的赢。但因为那四个已经从 props 里解构出来了（第 72-91 行），
// style 里不可能再有它们，所以这个顺序实际不产生覆盖。
// 真正有意义的是最后的 overflowX/overflowY：它们在 `...style` **之后**，
// 保证覆盖掉 style 里可能带的 overflow。'''),
]
