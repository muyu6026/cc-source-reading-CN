// 从自然语言文本里解析 token 预算：支持「开头或结尾的简写（+500k）」与「正文里的完整说法（use 2M tokens）」两类写法，并给出匹配区间供高亮。
// Shorthand (+500k) anchored to start/end to avoid false positives in natural language.
// Verbose (use/spend 2M tokens) matches anywhere.
const SHORTHAND_START_RE = /^\s*\+(\d+(?:\.\d+)?)\s*(k|m|b)\b/i
// Lookbehind (?<=\s) is avoided — it defeats YARR JIT in JSC, and the
// interpreter scans O(n) even with the $ anchor. Capture the whitespace
// instead; callers offset match.index by 1 where position matters.
const SHORTHAND_END_RE = /\s\+(\d+(?:\.\d+)?)\s*(k|m|b)\s*[.!?]?\s*$/i
const VERBOSE_RE = /\b(?:use|spend)\s+(\d+(?:\.\d+)?)\s*(k|m|b)\s*tokens?\b/i
const VERBOSE_RE_G = new RegExp(VERBOSE_RE.source, 'gi')

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
}
// `MULTIPLIERS` 把 k/m/b 后缀映射为千、百万、十亿的系数；任何解析结果都乘以它还原成真实 token 数。

// `parseBudgetMatch` 把匹配到的数值与后缀相乘，得到以 token 为单位的预算值。
function parseBudgetMatch(value: string, suffix: string): number {
  return parseFloat(value) * MULTIPLIERS[suffix.toLowerCase()]!
}

// `parseTokenBudget` 按优先级依次尝试三种正则：开头简写、结尾简写、完整说法，命中其一即返回数值，否则返回空。
export function parseTokenBudget(text: string): number | null {
  const startMatch = text.match(SHORTHAND_START_RE)
  if (startMatch) return parseBudgetMatch(startMatch[1]!, startMatch[2]!)
  const endMatch = text.match(SHORTHAND_END_RE)
  if (endMatch) return parseBudgetMatch(endMatch[1]!, endMatch[2]!)
  const verboseMatch = text.match(VERBOSE_RE)
  if (verboseMatch) return parseBudgetMatch(verboseMatch[1]!, verboseMatch[2]!)
  return null
}

// `findTokenBudgetPositions` 返回所有预算表达的起止区间，用于界面高亮；结尾简写若已被开头简写覆盖则跳过，避免重复计数。
export function findTokenBudgetPositions(
  text: string,
): Array<{ start: number; end: number }> {
  const positions: Array<{ start: number; end: number }> = []
  const startMatch = text.match(SHORTHAND_START_RE)
  if (startMatch) {
    const offset =
      startMatch.index! +
      startMatch[0].length -
      startMatch[0].trimStart().length
    positions.push({
      start: offset,
      end: startMatch.index! + startMatch[0].length,
    })
  }
  const endMatch = text.match(SHORTHAND_END_RE)
  if (endMatch) {
    // Avoid double-counting when input is just "+500k"
    const endStart = endMatch.index! + 1 // +1: regex includes leading \s
    const alreadyCovered = positions.some(
      p => endStart >= p.start && endStart < p.end,
    )
    if (!alreadyCovered) {
      positions.push({
        start: endStart,
        end: endMatch.index! + endMatch[0].length,
      })
    }
  }
  for (const match of text.matchAll(VERBOSE_RE_G)) {
    positions.push({ start: match.index, end: match.index + match[0].length })
  }
  return positions
}

// `getBudgetContinuationMessage` 生成「已达到预算百分比、继续工作不要总结」的续写提示，数字用千分位格式化。
export function getBudgetContinuationMessage(
  pct: number,
  turnTokens: number,
  budget: number,
): string {
  const fmt = (n: number): string => new Intl.NumberFormat('en-US').format(n)
  return `Stopped at ${pct}% of token target (${fmt(turnTokens)} / ${fmt(budget)}). Keep working \u2014 do not summarize.`
}
