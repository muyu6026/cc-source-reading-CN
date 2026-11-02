import {
// 按显示宽度切 ANSI 字符串：自研而不依赖 slice-ansi 包，核心原因是那个包不能正确处理 OSC 8 超链接序列，而 ansi-tokenize 可以。
  type AnsiCode,
  ansiCodesToString,
  reduceAnsiCodes,
  tokenize,
  undoAnsiCodes,
} from '@alcalzone/ansi-tokenize'
import { stringWidth } from '../ink/stringWidth.js'
// stringWidth 是宽度基准：东亚全角算 2、组合符算 0，调用方传的 start 与 end 也是这套「显示格」单位。

// A code is an "end code" if its code equals its endCode (e.g., hyperlink close)
function isEndCode(code: AnsiCode): boolean {
  return code.code === code.endCode
}

// Filter to only include "start codes" (not end codes)
function filterStartCodes(codes: AnsiCode[]): AnsiCode[] {
  return codes.filter(c => !isEndCode(c))
}
// 两个小工具：endCode 等于自身的 code 就是「结束码」（如超链接闭合），过滤后只留「起始码」，用于决定收尾要补哪些复位序列。

/**
 * Slice a string containing ANSI escape codes.
 *
 * Unlike the slice-ansi package, this properly handles OSC 8 hyperlink
 * sequences because @alcalzone/ansi-tokenize tokenizes them correctly.
 */
export default function sliceAnsi(
  str: string,
  start: number,
  end?: number,
): string {
  // Don't pass `end` to tokenize — it counts code units, not display cells,
  // so it drops tokens early for text with zero-width combining marks.
  const tokens = tokenize(str)
// tokenize 不传 end：它按码元计数而不是显示格，带零宽组合符的文本会提前丢 token——这是踩过的坑，注释专门记下。
  let activeCodes: AnsiCode[] = []
  let position = 0
  let result = ''
  let include = false

  for (const token of tokens) {
    // Advance by display width, not code units. Combining marks (Devanagari
    // matras, virama, diacritics) are width 0 — counting them via .length
    // advanced position past `end` early and truncated the slice. Callers
    // pass start/end in display cells (via stringWidth), so position must
    // track the same units.
    const width =
      token.type === 'ansi' ? 0 : token.fullWidth ? 2 : stringWidth(token.value)
// 每个 token 的步进量：ANSI 码宽度为 0，全角按 2，其余用 stringWidth。position 从此以显示格推进，与调用方单位一致。

    // Break AFTER trailing zero-width marks — a combining mark attaches to
    // the preceding base char, so "भा" (भ + ा, 1 display cell) sliced at
    // end=1 must include the ा. Breaking on position >= end BEFORE the
    // zero-width check would drop it and render भ bare. ANSI codes are
    // width 0 but must NOT be included past end (they open new style runs
    // that leak into the undo sequence), so gate on char type too. The
    // !include guard ensures empty slices (start===end) stay empty even
    // when the string starts with a zero-width char (BOM, ZWJ).
    if (end !== undefined && position >= end) {
      if (token.type === 'ansi' || width > 0 || !include) break
    }
// 越过 end 边界后的放行条件极讲究：零宽组合符必须带上（它属于前一个字），ANSI 码却绝不能带（会开新样式泄漏进 undo 序列），再加上 include 哨兵保证空切片保持为空。

    if (token.type === 'ansi') {
      activeCodes.push(token)
      if (include) {
        // Emit all ANSI codes during the slice
        result += token.code
      }
// 切片内的 ANSI 码原样发出：颜色、超链接在切开的片段里保持连续，靠结尾的 undo 序列复位。
    } else {
      if (!include && position >= start) {
        // Skip leading zero-width marks at the start boundary — they belong
        // to the preceding base char in the left half. Without this, the
        // mark appears in BOTH halves: left+right ≠ original. Only applies
        // when start > 0 (otherwise there's no preceding char to own it).
        if (start > 0 && width === 0) continue
        include = true
        // Reduce and filter to only active start codes
        activeCodes = filterStartCodes(reduceAnsiCodes(activeCodes))
        result = ansiCodesToString(activeCodes)
// 进入切片时做一次「归并与过滤」：activeCodes 里可能堆了重复开关，reduce 后只留仍然生效的起始码，且再次过滤掉结束码。
      }

      if (include) {
        result += token.value
      }

      position += width
    }
  }

  // Only undo start codes that are still active
  const activeStartCodes = filterStartCodes(reduceAnsiCodes(activeCodes))
  result += ansiCodesToString(undoAnsiCodes(activeStartCodes))
// 收尾只 undo 还活着的起始码：如果按原始列表 undo，会把切片内已结束的样式也多补一层复位序列，产生冗余转义。
  return result
}
// 核心不变量：左半加右半重新拼回去要等于原文。起点跳过零宽符、终点带上零宽符，两个边界规则就是为这条不变量服务的。
