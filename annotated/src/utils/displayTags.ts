// 文件级摘要：把系统注入的 XML 包裹标签从展示标题里剥掉。
// 用一个泛化正则而不是白名单，是因为通知类型一直在加，白名单必然滞后。
/**
 * Matches any XML-like `<tag>…</tag>` block (lowercase tag names, optional
 * attributes, multi-line content). Used to strip system-injected wrapper tags
 * from display titles — IDE context, slash-command markers, hook output,
 * task notifications, channel messages, etc. A generic pattern avoids
 * maintaining an ever-growing allowlist that falls behind as new notification
 * types are added.
 *
 * Only matches lowercase tag names (`[a-z][\w-]*`) so user prose mentioning
 * JSX/HTML components ("fix the <Button> layout", "<!DOCTYPE html>") passes
 * through — those start with uppercase or `!`. The non-greedy body with a
 * backreferenced closing tag keeps adjacent blocks separate; unpaired angle
 * brackets ("when x < y") don't match.
 */
const XML_TAG_BLOCK_PATTERN = /<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>\n?/g
// 正则的三条设计约束，改动前务必想清楚：
// 标签名只认小写开头，让用户写的 `Button` 组件、`DOCTYPE` 这类大写原样保留；
// 闭合标签用反向引用匹配同名，非贪婪正文保证相邻块各自独立；
// 必须成对出现，因此散文里的 `x < y` 不会被误吞。

/**
 * Strip XML-like tag blocks from text for use in UI titles (/rewind, /resume,
 * bridge session titles). System-injected context — IDE metadata, hook output,
 * task notifications — arrives wrapped in tags and should never surface as a
 * title.
 *
 * If stripping would result in empty text, returns the original unchanged
 * (better to show something than nothing).
 */
export function stripDisplayTags(text: string): string {
  const result = text.replace(XML_TAG_BLOCK_PATTERN, '').trim()
  return result || text
}
// 剥完为空就返回原文——标题位置上宁可显示一串标签，也好过显示空白。

/**
 * Like stripDisplayTags but returns empty string when all content is tags.
 * Used by getLogDisplayTitle to detect command-only prompts (e.g. /clear)
 * so they can fall through to the next title fallback, and by extractTitleText
 * to skip pure-XML messages during bridge title derivation.
 */
export function stripDisplayTagsAllowEmpty(text: string): string {
  return text.replace(XML_TAG_BLOCK_PATTERN, '').trim()
}
// 变体版本不兜底：全被剥光就返回空串。调用方靠这个空值判断「这是一条纯标签消息」，从而继续往下找标题备选。

const IDE_CONTEXT_TAGS_PATTERN =
  /<(ide_opened_file|ide_selection)(?:\s[^>]*)?>[\s\S]*?<\/\1>\n?/g
// 只针对 IDE 注入的两类标签（打开文件、编辑器选区）单独建正则，粒度比上面那个泛化版更窄。

/**
 * Strip only IDE-injected context tags (ide_opened_file, ide_selection).
 * Used by textForResubmit so UP-arrow resubmit preserves user-typed content
 * including lowercase HTML like `<code>foo</code>` while dropping IDE noise.
 */
export function stripIdeContextTags(text: string): string {
  return text.replace(IDE_CONTEXT_TAGS_PATTERN, '').trim()
}
// 上箭头重新提交专用：只清 IDE 噪音，保留用户自己敲的小写 HTML 片段，例如行内的 code 标签。
