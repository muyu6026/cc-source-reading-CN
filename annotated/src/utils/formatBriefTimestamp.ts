// 简报与聊天消息的时间标签格式化。显示粒度随距今时长自动收缩：当天只显示时分，一周内补星期，更久远的再补月日；同时自己解析 POSIX 区域设置环境变量，绕开 Bun 与 V8 在 macOS 上忽略这些变量的行为差异。
/**
 * Format an ISO timestamp for the brief/chat message label line.
 *
 * Display scales with age (like a messaging app):
 *   - same day:      "1:30 PM" or "13:30" (locale-dependent)
 *   - within 6 days: "Sunday, 4:15 PM" (locale-dependent)
 *   - older:         "Sunday, Feb 20, 4:30 PM" (locale-dependent)
 *
 * Respects POSIX locale env vars (LC_ALL > LC_TIME > LANG) for time format
 * (12h/24h), weekday names, month names, and overall structure.
 * Bun/V8's `toLocaleString(undefined)` ignores these on macOS, so we
 * convert them to BCP 47 tags ourselves.
 *
 * `now` is injectable for tests.
 */
export function formatBriefTimestamp(
  isoString: string,
  now: Date = new Date(),
): string {
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) {
    return ''
  }

  const locale = getLocale()
  const dayDiff = startOfDay(now) - startOfDay(d)
  const daysAgo = Math.round(dayDiff / 86_400_000)

  if (daysAgo === 0) {
    return d.toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
    })
  }
// 当天分支只输出时间，不给星期。三个分支共用同一套区域设置，所以 12 小时制与 24 小时制、星期与月份名称都随区域变化，代码本身不硬编码任何语言。

  if (daysAgo > 0 && daysAgo < 7) {
    return d.toLocaleString(locale, {
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return d.toLocaleString(locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
// 函数入口先做时间戳有效性判定，非法输入返回空串而不是抛异常——标签行不该因为一条脏数据让整段渲染失败。天数差用「各自当天零点的毫秒差」再除以一天的毫秒数并四舍五入，避免跨夏令时导致的 23 或 25 小时误差。

/**
 * Derive a BCP 47 locale tag from POSIX env vars.
 * LC_ALL > LC_TIME > LANG, falls back to undefined (system default).
 * Converts POSIX format (en_GB.UTF-8) to BCP 47 (en-GB).
 */
function getLocale(): string | undefined {
  const raw =
    process.env.LC_ALL || process.env.LC_TIME || process.env.LANG || ''
  if (!raw || raw === 'C' || raw === 'POSIX') {
    return undefined
  }
  // Strip codeset (.UTF-8) and modifier (@euro), replace _ with -
  const base = raw.split('.')[0]!.split('@')[0]!
  if (!base) {
    return undefined
  }
  const tag = base.replaceAll('_', '-')
  // Validate by trying to construct an Intl locale — invalid tags throw
  try {
    new Intl.DateTimeFormat(tag)
    return tag
  } catch {
    return undefined
  }
}
// getLocale 负责把 POSIX 区域变量翻译成 BCP 47 标签：按 LC_ALL、LC_TIME、LANG 的优先级取第一个非空值，剥掉点号后的编码与 at 号后的修饰符，再把下划线换成连字符。值等于 C 或 POSIX 时视为无偏好，返回 undefined 交给系统默认。

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
// 最后一步用尝试构造 Intl.DateTimeFormat 来验证标签合法，构造成功才返回，否则同样退回系统默认。这是把「合法性校验」交给运行期实现本身，比自己维护一份白名单更可靠。
