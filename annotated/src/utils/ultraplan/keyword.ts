type TriggerPosition = { word: string; start: number; end: number }
// 关键词触发位置检测——判断文本里是否出现 ultraplan / ultrareview 这种「启动指令」，并精确定位，供 PromptInput 做彩虹高亮与「将启动」提示。

const OPEN_TO_CLOSE: Record<string, string> = {
  '`': '`',
  '"': '"',
  '<': '>',
  '{': '}',
  '[': ']',
  '(': ')',
  "'": "'",
}
// 成对分隔符映射表：记录每种开符号（反引号/双引号/尖括号/花括号/方括号/圆括号/单引号）对应的闭符号，用于扫描时跳过成对区域。

/**
 * Find keyword positions, skipping occurrences that are clearly not a
 * launch directive:
 *
 * - Inside paired delimiters: backticks, double quotes, angle brackets
 *   (tag-like only, so `n < 5 ultraplan n > 10` is not a phantom range),
 *   curly braces, square brackets (innermost — preExpansionInput has
 *   `[Pasted text #N]` placeholders), parentheses. Single quotes are
 *   delimiters only when not an apostrophe — the opening quote must be
 *   preceded by a non-word char (or start) and the closing quote must be
 *   followed by a non-word char (or end), so "let's ultraplan it's"
 *   still triggers.
 *
 * - Path/identifier-like context: immediately preceded or followed by
 *   `/`, `\`, or `-`, or followed by `.` + word char (file extension).
 *   `\b` sees a boundary at `-`, so `ultraplan-s` would otherwise
 *   match. This keeps `src/ultraplan/foo.ts`, `ultraplan.tsx`, and
 *   `--ultraplan-mode` from triggering while `ultraplan.` at a sentence
 *   end still does.
 *
 * - Followed by `?`: a question about the feature shouldn't invoke it.
 *   Other sentence punctuation (`.`, `,`, `!`) still triggers.
 *
 * - Slash command input: text starting with `/` is a slash command
 *   invocation (processUserInput.ts routes it to processSlashCommand,
 *   not keyword detection), so `/rename ultraplan foo` never triggers.
 *   Without this, PromptInput would rainbow-highlight the word and show
 *   the "will launch ultraplan" notification even though submitting the
 *   input runs /rename, not /ultraplan.
 *
 * Shape matches findThinkingTriggerPositions (thinking.ts) so
 * PromptInput treats both trigger types uniformly.
 */
// 找出关键词的触发位置，跳过明显不是启动指令的情形：成对分隔符内部（反引号/引号/尖括号/花括号/方括号/圆括号，单引号仅当非撇号时）、路径/标识符上下文（前后是斜杠、反斜杠、连字符或点加单词）、后接问号的疑问句，以及以斜杠开头的斜杠命令。形状与 findThinkingTriggerPositions 对齐，便于 PromptInput 统一处理。
function findKeywordTriggerPositions(
  text: string,
  keyword: string,
): TriggerPosition[] {
  const re = new RegExp(keyword, 'i')
// 核心函数：参数 text 为待检测文本，keyword 为关键词（大小写不敏感）。
  if (!re.test(text)) return []
  if (text.startsWith('/')) return []
  const quotedRanges: Array<{ start: number; end: number }> = []
// 先收集所有成对分隔符覆盖的区间，供后续排除（避免把字符串/标签内部当成指令）。
  let openQuote: string | null = null
  let openAt = 0
  const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch)
  for (let i = 0; i < text.length; i++) {
// 逐字符扫描，维护当前开符号与开位置，遇闭符号就记录区间。
    const ch = text[i]!
    if (openQuote) {
      if (openQuote === '[' && ch === '[') {
        openAt = i
        continue
      }
      if (ch !== OPEN_TO_CLOSE[openQuote]) continue
      if (openQuote === "'" && isWord(text[i + 1])) continue
      quotedRanges.push({ start: openAt, end: i + 1 })
      openQuote = null
    } else if (
      (ch === '<' && i + 1 < text.length && /[a-zA-Z/]/.test(text[i + 1]!)) ||
      (ch === "'" && !isWord(text[i - 1])) ||
      (ch !== '<' && ch !== "'" && ch in OPEN_TO_CLOSE)
    ) {
      openQuote = ch
      openAt = i
    }
  }

  const positions: TriggerPosition[] = []
// 开始收集最终触发位置。
  const wordRe = new RegExp(`\\b${keyword}\\b`, 'gi')
// 用单词边界正则找出所有关键词匹配。
  const matches = text.matchAll(wordRe)
  for (const match of matches) {
    if (match.index === undefined) continue
    const start = match.index
    const end = start + match[0].length
    if (quotedRanges.some(r => start >= r.start && start < r.end)) continue
// 跳过落在成对分隔符区间内的匹配（那是字符串/标签内部，不是指令）。
    const before = text[start - 1]
    const after = text[end]
    if (before === '/' || before === '\\' || before === '-') continue
// 关键词前后若是路径或标识符上下文（斜杠、反斜杠、连字符）则跳过，避免 src/ultraplan/foo.ts 这类被误触发。
    if (after === '/' || after === '\\' || after === '-' || after === '?')
      continue
    if (after === '.' && isWord(text[end + 1])) continue
    positions.push({ word: match[0], start, end })
  }
  return positions
}

export function findUltraplanTriggerPositions(text: string): TriggerPosition[] {
// 对外接口：检测 ultraplan 触发位置。
  return findKeywordTriggerPositions(text, 'ultraplan')
}

export function findUltrareviewTriggerPositions(
// 对外接口：检测 ultrareview 触发位置。
  text: string,
): TriggerPosition[] {
  return findKeywordTriggerPositions(text, 'ultrareview')
}

export function hasUltraplanKeyword(text: string): boolean {
// 判断文本是否含可触发的 ultraplan 关键词。
  return findUltraplanTriggerPositions(text).length > 0
}

export function hasUltrareviewKeyword(text: string): boolean {
// 判断文本是否含可触发的 ultrareview 关键词。
  return findUltrareviewTriggerPositions(text).length > 0
}

/**
 * Replace the first triggerable "ultraplan" with "plan" so the forwarded
 * prompt stays grammatical ("please ultraplan this" → "please plan this").
 * Preserves the user's casing of the "plan" suffix.
 */
// 把第一个可触发的 ultraplan 替换成 plan，让转发的提示词语法通顺（保留 plan 后缀的大小写）。
export function replaceUltraplanKeyword(text: string): string {
  const [trigger] = findUltraplanTriggerPositions(text)
// 取出首个触发点，没有就原样返回文本。
  if (!trigger) return text
  const before = text.slice(0, trigger.start)
  const after = text.slice(trigger.end)
  if (!(before + after).trim()) return ''
  return before + trigger.word.slice('ultra'.length) + after
}
