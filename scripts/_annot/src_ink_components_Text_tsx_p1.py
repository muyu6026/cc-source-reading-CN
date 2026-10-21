# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (48, 'after', '''// 【bold 和 dim 为什么必须互斥】
//
// 不是风格偏好，是 SGR 的表示能力不够：**SGR 22 同时取消粗体和暗色**
// （「normal intensity」，一对二）。终端里没有「只关掉 dim、保留 bold」
// 的办法。
//
// 所以如果允许同时传，渲染时得按顺序发 1（bold）和 2（dim），
// 之后想单独取消其中一个就做不到了 —— 只能两个一起关。
//
// 这里的选择是「把物理限制提前到类型层」：用三个成员的联合类型
// 让 `bold + dim` 编译不过。`bold?: never` 那一手是关键 ——
// 只写 `bold?: boolean; dim?: boolean` 是拦不住的。
//
// 这一条和 termio/sgr.ts 里「22 一对二」是同一件事的两端：
// 那边是解析时承认这个限制，这边是构造时就禁止。'''),
    (109, 'after', '''// 【八个常量样式对象，为什么不是每次现造】
//
// 因为 reconciler 的 setStyle 是**按值比较**的（dom.ts 里逐键比）。
// 每次渲染造一个新对象 → 每次都比一遍 → 值相同则不标脏。
// 所以功能上不需要缓存，缓存省的是那 8 个键的比较，以及一次分配。
//
// 真正需要缓存的是别的：`memoizedStylesForWrap[wrap]` 让同一个 wrap
// 值永远拿到**同一个对象引用**，于是下面 `$[26] !== t15` 这一层
// memo 才能命中。换句话说，这八个字面量是为了让 React Compiler
// 的引用比较有效，而不是给 reconciler 看的。
//
// 注意每个条目都重复写了 flexGrow: 0 / flexShrink: 1 / flexDirection: 'row'
// —— 四行一模一样。这不能提取成公共对象（那样每个条目都要展开一次，
// 引用就又不稳定了）。'''),
    (113, 'after', '''// 组件体只有三件事：把 8 个可选的样式开关拼成 textStyles、
// 按 wrap 查表取布局样式，然后交给 ink-text。
//
// 值得注意的两处：
//   · 每个开关都是 `x && {x}`（第 138 行那种写法），false/undefined
//     时展开的是 false，`{...false}` 是合法且为空的 —— 所以不需要
//     先过滤，八次展开里没开的那些贡献零个键
//   · children 为空时直接返回 null（第 133 行），连一层空节点都不建。
//     这在「条件渲染文本」时很重要：`<Text>{maybe}</Text>` 在 maybe 为
//     undefined 时不占位、不影响布局'''),
    (241, 'after', '''// 按 wrap 查表，而不是「用 wrap 构造样式」。
// 好处是布局样式对象引用稳定；坏处是这 8 个 wrap 值被写死了三遍
// （styles.ts 的类型、这里的表、以及 wrap-text.ts 的分支）。
// 新增一种 wrap 要改三处，TypeScript 只能保证前两处一致
// （Record<NonNullable<Styles['textWrap']>, Styles> 会漏掉第三处）。'''),
    (244, 'after', '''// 【两个 prop，一条世界分割线】
//
//   style       布局（flex、margin、padding、overflow…）→ 走 yoga setter
//   textStyles  字样式（color、bold、italic…）→ 走 StylePool 的字体位
//
// 分成两个不是历史包袱，是**两个不同的求值时机**：
// 布局在 commit 后的同步阶段算（yoga 要它），字体样式要到绘字时才用
// （colorize 拼 SGR）。混在一个对象里的话，每次改颜色都会让 yoga
// 重新设一遍布局属性（dom.ts 的 setStyle 得逐个判断是哪个域）。
//
// 顺带：Text 只能包在 ink-text 里，ink-text 在 yoga 里挂 measure 回调
// （measure-text.ts），这就是「Text 里不能放 Box」「裸字符串必须包 Text」
// 两条规则的来源。'''),
]
