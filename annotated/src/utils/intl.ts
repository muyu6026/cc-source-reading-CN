/**
 * Shared Intl object instances with lazy initialization.
 *
 * Intl constructors are expensive (~0.05-0.1ms each), so we cache instances
 * for reuse across the codebase instead of creating new ones each time.
 * Lazy initialization ensures we only pay the cost when actually needed.
 */
// 共享 Intl 实例的惰性缓存：Intl 构造器单个要 0.05 到 0.1 毫秒，分词器、相对时间格式化、时区、系统语言全部只建一次、全仓复用。

// Segmenters for Unicode text processing (lazily initialized)
let graphemeSegmenter: Intl.Segmenter | null = null
let wordSegmenter: Intl.Segmenter | null = null
// 两个 Segmenter 各管一摊：grapheme 按字素切（emoji、组合字符算一个），word 按词切。都允许传 undefined 用默认 locale。

export function getGraphemeSegmenter(): Intl.Segmenter {
  if (!graphemeSegmenter) {
    graphemeSegmenter = new Intl.Segmenter(undefined, {
      granularity: 'grapheme',
    })
  }
  return graphemeSegmenter
}
// 惰性初始化的固定写法：先判空再建。首调用付出构造成本，之后所有调用只是返回同一个引用。

/**
 * Extract the first grapheme cluster from a string.
 * Returns '' for empty strings.
 */
export function firstGrapheme(text: string): string {
  if (!text) return ''
  const segments = getGraphemeSegmenter().segment(text)
  const first = segments[Symbol.iterator]().next().value
  return first?.segment ?? ''
}
// 取第一个字素：用迭代器只走一步就停，不做全串分词。空串约定返回空串而不是 undefined。

/**
 * Extract the last grapheme cluster from a string.
 * Returns '' for empty strings.
 */
export function lastGrapheme(text: string): string {
  if (!text) return ''
  let last = ''
  for (const { segment } of getGraphemeSegmenter().segment(text)) {
    last = segment
  }
  return last
}
// 取最后一个字素只能整段遍历：Segmenter 没有反向迭代，字符串场景短（用户名、按键标签），代价可接受。

export function getWordSegmenter(): Intl.Segmenter {
  if (!wordSegmenter) {
    wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  }
  return wordSegmenter
}

// RelativeTimeFormat cache (keyed by style:numeric)
const rtfCache = new Map<string, Intl.RelativeTimeFormat>()

export function getRelativeTimeFormat(
  style: 'long' | 'short' | 'narrow',
  numeric: 'always' | 'auto',
): Intl.RelativeTimeFormat {
  const key = `${style}:${numeric}`
  let rtf = rtfCache.get(key)
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat('en', { style, numeric })
    rtfCache.set(key, rtf)
  }
  return rtf
}
// RelativeTimeFormat 按「样式:数字模式」组合做键缓存：六种组合各建一次，locale 固定为 en，因为输出只进内部日志不进 UI。

// Timezone is constant for the process lifetime
let cachedTimeZone: string | null = null

export function getTimeZone(): string {
  if (!cachedTimeZone) {
    cachedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  }
  return cachedTimeZone
}
// 时区整个进程生命周期不会变，所以解析一次就缓存；resolvedOptions 本身比看起来贵。

// System locale language subtag (e.g. 'en', 'ja') is constant for the process
// lifetime. null = not yet computed; undefined = computed but unavailable (so
// a stripped-ICU environment fails once instead of retrying on every call).
let cachedSystemLocaleLanguage: string | undefined | null = null

export function getSystemLocaleLanguage(): string | undefined {
  if (cachedSystemLocaleLanguage === null) {
    try {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale
      cachedSystemLocaleLanguage = new Intl.Locale(locale).language
    } catch {
      cachedSystemLocaleLanguage = undefined
    }
  }
  return cachedSystemLocaleLanguage
}
// 系统语言的三态缓存最讲究：null 表示还没算过、undefined 表示算过但环境没有完整 ICU（被裁剪的构建）。用 undefined 记住失败，避免每次调用都重试再抛一次。
