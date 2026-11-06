import memoize from 'lodash-es/memoize.js'
// 通用日期工具：取本地 ISO 日期（支持测试用日期覆盖）、会话起始日期（memoize 以稳定 prompt 缓存）、本地月份年份（按月变化、减少缓存抖动）。

// This ensures you get the LOCAL date in ISO format
export function getLocalISODate(): string {
// 取本地日期 ISO 串；若设了 ant 专用日期覆盖则用覆盖值。
  // Check for ant-only date override
// 检查 ant 专用日期覆盖环境变量。
  if (process.env.CLAUDE_CODE_OVERRIDE_DATE) {
    return process.env.CLAUDE_CODE_OVERRIDE_DATE
  }

  const now = new Date()
// 年/月/日各位数补齐，拼成 YYYY-MM-DD。
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Memoized for prompt-cache stability — captures the date once at session start.
// The main interactive path gets this behavior via memoize(getUserContext) in
// context.ts; simple mode (--bare) calls getSystemPrompt per-request and needs
// an explicit memoized date to avoid busting the cached prefix at midnight.
// When midnight rolls over, getDateChangeAttachments appends the new date at
// the tail (though simple mode disables attachments, so the trade-off there is:
// stale date after midnight vs. ~entire-conversation cache bust — stale wins).
// memoize 让会话启动时取一次日期，避免午夜翻面时整段缓存失效；极简模式每请求取提示，需显式 memoize 日期以免缓存前缀被打散。
export const getSessionStartDate = memoize(getLocalISODate)
// 会话起始日期：memoize 包装，进程内同一天稳定。

// Returns "Month YYYY" (e.g. "February 2026") in the user's local timezone.
// Changes monthly, not daily — used in tool prompts to minimize cache busting.
export function getLocalMonthYear(): string {
// 本地月份年份，按月变化，用于工具提示减少缓存破坏。
  const date = process.env.CLAUDE_CODE_OVERRIDE_DATE
    ? new Date(process.env.CLAUDE_CODE_OVERRIDE_DATE)
    : new Date()
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' })
}
