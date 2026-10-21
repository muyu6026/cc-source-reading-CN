// ═══════════════════════════════════════════════════════════════
//  tab 展开：为什么必须自己算
// ═══════════════════════════════════════════════════════════════
//
//  制表符的宽度**取决于它在第几列**：8 列停靠点上，第 0 列的 tab 是
//  8 格宽，第 7 列的 tab 是 1 格宽。终端自己会算，但这里不能交给
//  终端 —— 因为渲染器要预先知道「这一行多宽」才能排版、才能决定
//  折行位置。所以必须自己展开成空格。
//
//  唯一调用方：`dom.ts:342`，在 `measureTextNode` 里（也就是
//  yoga 的 measure 回调）。**展开发生在测量之前**，这样量和画用的是
//  同一个字符串。
//
//  注释提到灵感来自 Ghostty 的 Tabstops.zig —— 8 列是 POSIX 的默认值，
//  也是绝大多数终端的硬编码值。
// Tab expansion, inspired by Ghostty's Tabstops.zig
// Uses 8-column intervals (POSIX default, hardcoded in terminals like Ghostty)

import { stringWidth } from './stringWidth.js'
import { createTokenizer } from './termio/tokenize.js'

const DEFAULT_TAB_INTERVAL = 8

export function expandTabs(
  text: string,
  interval = DEFAULT_TAB_INTERVAL,
): string {
// 没有 tab 就直接返回**原字符串**（连拷贝都不做）。
//
//  这条早退的性价比极高：绝大多数文本没有 tab（代码块里才有），
//  而每个 Text 节点的测量都要过这个函数。
  if (!text.includes('\t')) {
    return text
  }

// 用 `tokenize` 而不是直接 `split('\t')` —— 这是整份文件的关键：
//
//  文本里可能夹着 ANSI 转义序列（`<Ansi>` 组件、语法高亮的产物）。
//  一个转义序列的**字节**里有各种字符，如果按字符扫，序列内部的
//  某个字节可能被当成分隔符，或者序列本身的长度被算进列宽。
//
//  所以先切分：`sequence`（转义序列，原样输出、**不计列宽**）、
//  `text`（纯文本，要扫 tab、要算宽度）。
//
//  这也是 termio/tokenize.ts 除了「解析输入」之外的第二个用途 ——
//  它是个通用的「把转义序列和文本分开」的工具。
  const tokenizer = createTokenizer()
  const tokens = tokenizer.feed(text)
  tokens.push(...tokenizer.flush())

  let result = ''
  let column = 0

  for (const token of tokens) {
    if (token.type === 'sequence') {
      result += token.value
    } else {
// `split(/(\t|\n)/)` —— 带捕获组的分割会**保留分隔符**。
//
//  不带捕获组的话 `'a\tb'.split(/\t|\n/)` 得到 `['a', 'b']`，
//  tab 本身丢了 —— 而这里恰恰要靠 part === '\t' 来判断。
//
//  这个细节很容易写错，写错的表现是「tab 变成空字符串」→ 宽度少算 8。
      const parts = token.value.split(/(\t|\n)/)
      for (const part of parts) {
        if (part === '\t') {
// `interval - (column % interval)` —— 补到下一个停靠点。
//
//  第 0 列：8 - 0 = 8 格
//  第 7 列：8 - 7 = 1 格
//  第 8 列：8 - 0 = 8 格
//
//  注意 `column` 是**视觉列**（用 stringWidth 累加），不是字符下标 ——
//  所以一行里有汉字时，tab 的停靠位置会跟着变。这是对的：终端里
//  tab 是按格子对齐的，不是按字符数。
          const spaces = interval - (column % interval)
          result += ' '.repeat(spaces)
          column += spaces
// 换行重置列号。一个真正重要的细节：`expandTabs` 处理的是
//  **多行字符串**（Text 的子节点可能含换行），而 tab 停靠点是
//  **逐行**重新开始的。
//
//  不重置的话，第二行的 tab 会按第一行末尾的列号算 —— 宽度全错。
        } else if (part === '\n') {
          result += part
          column = 0
        } else {
          result += part
// 纯文本部分按视觉宽度累加。这里用的是 `stringWidth(part)` 而不是
//  `part.length` —— 中文一个字占 2 格，`length` 是 1。
//
//  代价是每段文本都要量一次（无法避免，因为要算下一个 tab 的停靠点）。
//  但注意这是**展开阶段**，产物会进缓存（Output 的 charCache 或
//  line-width-cache），不会每帧重算。
          column += stringWidth(part)
        }
      }
    }
  }

  return result
}
