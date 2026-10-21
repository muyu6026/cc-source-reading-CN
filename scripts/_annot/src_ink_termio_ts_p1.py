# -*- coding: utf-8 -*-
"""ink/termio.ts 批注：桶文件（1-43）。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  桶文件：只做转发，但「转发哪些」本身说明了用途
// ═══════════════════════════════════════════════════════════════
//
//   这个文件把 termio/ 目录里的东西重新导出，但它**只导出读取侧**：
//     Parser        语义解析器
//     各种 type     Action / Color / TextStyle / Grapheme …
//     defaultStyle / stylesEqual / colorsEqual
//
//   没有导出任何**生成函数**（csi / decset / osc / link …）。
//   那些是走深路径直接 import 的：
//     ink.tsx        from './termio/csi.js'
//     log-update.ts  from './termio/csi.js'
//     terminal.ts    from './termio/csi.js' + './termio/dec.js'
//
//   【这个不对称是有意义的】
//   需要读的一方只有一个（Ansi.tsx），它想要一个干净的入口；
//   需要写的一方有十几个，每个只需要一两个函数，走深路径更省 ——
//   也避免了「改一个生成函数导致所有引用桶文件的模块重新解析」。
//
//   换个说法：**桶文件是给「消费者」的，不是给「协作者」的。**'''),

(23, 'before', '''// 【只导出一个类，其余全是类型】
//
//   Parser 是唯一的运行期值（`export { Parser }`），所以它不能被
//   tree-shaking 摇掉 —— 但也只有 394 行，无所谓。
//
//   反过来说：如果不导出 Parser，整个 parser.ts / sgr.ts / esc.ts
//   都不会被打进产物（如果没有任何其他模块引用）。这就是为什么
//   这个文件只有一行「值导出」而不是一堆。'''),

(26, 'before', '''// 【类型清单里有两个「导出但没人用」的项】
//
//   TextSegment   types.ts 211 行有批注：从没有消费者，
//                 而且是和 utils/textHighlighting.ts 里另一个同名类型
//                 完全不同的东西 —— 同名不同义，搜代码时容易看错。
//
//   其余（Action / Color / TextStyle / Grapheme / 各种 Action）
//   都是 Ansi.tsx 实际用到的，或者作为 Action 联合的成员被间接需要。
//
//   这也是读桶文件的一般方法：**拿 `grep` 数一遍每个导出的引用数**，
//   引用数为 0 的就是历史残留 —— 比读注释快得多。'''),
]
