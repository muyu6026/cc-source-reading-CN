// 提供两份 XML/HTML 转义函数，用于在标签之间的文本内容、或属性值里，安全地插值不可信字符串（进程标准输出、用户输入、外部数据）。
/**
 * Escape XML/HTML special characters for safe interpolation into element
 * text content (between tags). Use when untrusted strings (process stdout,
 * user input, external data) go inside `<tag>${here}</tag>`.
 */
export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
// escapeXml：把 &、<、> 三个字符转成对应实体，适用于标签之间的文本内容插值。

/**
 * Escape for interpolation into a double- or single-quoted attribute value:
 * `<tag attr="${here}">`. Escapes quotes in addition to `& < >`.
 */
export function escapeXmlAttr(s: string): string {
  return escapeXml(s).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
// escapeXmlAttr：在 escapeXml 的基础上再转义双引号与单引号（&quot;、&apos;），适用于被双引号或单引号包裹的属性值插值。
