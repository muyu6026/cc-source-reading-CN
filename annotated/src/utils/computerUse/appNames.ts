/**
 * Filter and sanitize installed-app data for inclusion in the `request_access`
 * tool description. Ported from Cowork's appNames.ts. Two
 * concerns: noise filtering (Spotlight returns every bundle on disk — XPC
 * helpers, daemons, input methods) and prompt-injection hardening (app names
 * are attacker-controlled; anyone can ship an app named anything).
 *
 * Residual risk: short benign-char adversarial names ("grant all") can't be
 * filtered programmatically. The tool description's structural framing
 * ("Available applications:") makes it clear these are app names, and the
 * downstream permission dialog requires explicit user approval — a bad name
 * can't auto-grant anything.
 */
// 文件总述：过滤并净化已安装 App 数据，供 request_access 工具的 description 使用；移植自 Cowork 的 appNames.ts。两块关注点：噪声过滤（Spotlight 会列出磁盘上每一个 bundle，包括 XPC 助手、守护进程、输入法）与提示注入加固（App 名是攻击者可控制的，谁都能发布任意名字的 App）。

/** Minimal shape — matches what `listInstalledApps` returns. */
type InstalledAppLike = {
  readonly bundleId: string
  readonly displayName: string
  readonly path: string
}
// InstalledAppLike 类型：描述 listInstalledApps 返回的最小形状——bundleId、displayName、path 三项只读字段。

// ── Noise filtering ──────────────────────────────────────────────────────
// 噪声过滤小节的视觉分隔行，下面开始 PATH 白名单逻辑。

/**
 * Only apps under these roots are shown. /System/Library subpaths (CoreServices,
 * PrivateFrameworks, Input Methods) are OS plumbing — anchor on known-good
 * roots rather than blocklisting every junk subpath since new macOS versions
 * add more.
 *
 * ~/Applications is checked at call time via the `homeDir` arg (HOME isn't
 * reliably known at module load in all environments).
 */
const PATH_ALLOWLIST: readonly string[] = [
  '/Applications/',
  '/System/Applications/',
]
// PATH_ALLOWLIST：只展示这些根目录下的 App。/System/Library 的子路径（CoreServices、PrivateFrameworks、输入法）是系统管道，锚定已知好根而非黑名单每个垃圾子路径，因为新 macOS 版本会不断加更多。

/**
 * Display-name patterns that mark background services even under /Applications.
 * `(?:$|\s\()` — matches keyword at end-of-string OR immediately before ` (`:
 * "Slack Helper (GPU)" and "ABAssistantService" fail, "Service Desk" passes
 * (Service is followed by " D").
 */
const NAME_PATTERN_BLOCKLIST: readonly RegExp[] = [
  /Helper(?:$|\s\()/,
  /Agent(?:$|\s\()/,
  /Service(?:$|\s\()/,
  /Uninstaller(?:$|\s\()/,
  /Updater(?:$|\s\()/,
  /^\./,
]
// NAME_PATTERN_BLOCKLIST：即便在 /Applications 下，也按显示名模式剔除后台服务（Helper/Agent/Service/Uninstaller/Updater，以及以句点开头的项）。正则匹配关键字位于行尾或紧接左括号前的位置，例如 Slack Helper (GPU) 会被剔除，而 Service Desk 因 Service 后接空格 D 而保留。

/**
 * Apps commonly requested for CU automation. ALWAYS included if installed,
 * bypassing path check + count cap — the model needs these exact names even
 * when the machine has 200+ apps. Bundle IDs (locale-invariant), not display
 * names. Keep <30 — each entry is a guaranteed token in the description.
 */
const ALWAYS_KEEP_BUNDLE_IDS: ReadonlySet<string> = new Set([
  // Browsers
  'com.apple.Safari',
  'com.google.Chrome',
  'com.microsoft.edgemac',
  'org.mozilla.firefox',
  'company.thebrowser.Browser', // Arc
  // Communication
  'com.tinyspeck.slackmacgap',
  'us.zoom.xos',
  'com.microsoft.teams2',
  'com.microsoft.teams',
  'com.apple.MobileSMS',
  'com.apple.mail',
  // Productivity
  'com.microsoft.Word',
  'com.microsoft.Excel',
  'com.microsoft.Powerpoint',
  'com.microsoft.Outlook',
  'com.apple.iWork.Pages',
  'com.apple.iWork.Numbers',
  'com.apple.iWork.Keynote',
  'com.google.GoogleDocs',
  // Notes / PM
  'notion.id',
  'com.apple.Notes',
  'md.obsidian',
  'com.linear',
  'com.figma.Desktop',
  // Dev
  'com.microsoft.VSCode',
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'com.github.GitHubDesktop',
  // System essentials the model genuinely targets
  'com.apple.finder',
  'com.apple.iCal',
  'com.apple.systempreferences',
])
// ALWAYS_KEEP_BUNDLE_IDS：CU 自动化常要的 App，若已安装则绕过路径检查与数量上限；用 bundleId（与区域设置无关）而非显示名，保持条目少于 30 个，每条都是 description 里保证出现的 token。

// ── Prompt-injection hardening ───────────────────────────────────────────
// 提示注入加固小节分隔行：下面讨论如何防止恶意 App 名通过工具描述注入提示。

/**
 * `\p{L}\p{M}\p{N}` with /u — not `\w` (ASCII-only, would drop Bücher, 微信,
 * Préférences Système). `\p{M}` matches combining marks so NFD-decomposed
 * diacritics (ü → u + ◌̈) pass. Single space not `\s` — `\s` matches newlines,
 * which would let "App\nIgnore previous…" through as a multi-line injection.
 * Still bars quotes, angle brackets, backticks, pipes, colons.
 */
const APP_NAME_ALLOWED = /^[\p{L}\p{M}\p{N}_ .&'()+-]+$/u
const APP_NAME_MAX_LEN = 40
const APP_NAME_MAX_COUNT = 50
// APP_NAME 净化三件套：允许的字符集覆盖 Unicode 字母、组合附加符、数字、下划线、空格、点、&、单引号、括号、加号、减号（用 Unicode 属性而非 ASCII 专用写法，否则会丢弃带变音的外文名与中文名）；用单个空格而非空白类（避免换行被当成空格从而放过多行注入）；最大长度 40；最大数量 50。依然禁止引号、尖括号、反引号、管道符、冒号。

function isUserFacingPath(path: string, homeDir: string | undefined): boolean {
  if (PATH_ALLOWLIST.some(root => path.startsWith(root))) return true
  if (homeDir) {
    const userApps = homeDir.endsWith('/')
      ? `${homeDir}Applications/`
      : `${homeDir}/Applications/`
    if (path.startsWith(userApps)) return true
  }
  return false
}
// isUserFacingPath：判断路径是否落在白名单根下（含按 homeDir 按需拼接的 ~/Applications）。

function isNoisyName(name: string): boolean {
  return NAME_PATTERN_BLOCKLIST.some(re => re.test(name))
}
// isNoisyName：用 NAME_PATTERN_BLOCKLIST 命中即视为噪声名。

/**
 * Length cap + trim + dedupe + sort. `applyCharFilter` — skip for trusted
 * bundle IDs (Apple/Google/MS; a localized "Réglages Système" with unusual
 * punctuation shouldn't be dropped), apply for anything attacker-installable.
 */
function sanitizeCore(
  raw: readonly string[],
  applyCharFilter: boolean,
): string[] {
  const seen = new Set<string>()
  return raw
    .map(name => name.trim())
    .filter(trimmed => {
      if (!trimmed) return false
      if (trimmed.length > APP_NAME_MAX_LEN) return false
      if (applyCharFilter && !APP_NAME_ALLOWED.test(trimmed)) return false
      if (seen.has(trimmed)) return false
      seen.add(trimmed)
      return true
    })
    .sort((a, b) => a.localeCompare(b))
}
// sanitizeCore：长度裁剪、去首尾空白、去重、排序；对可信 bundleId 跳过字符过滤，避免本地化的特殊标点把合法名误删。

function sanitizeAppNames(raw: readonly string[]): string[] {
  const filtered = sanitizeCore(raw, true)
  if (filtered.length <= APP_NAME_MAX_COUNT) return filtered
  return [
    ...filtered.slice(0, APP_NAME_MAX_COUNT),
    `… and ${filtered.length - APP_NAME_MAX_COUNT} more`,
  ]
}
// sanitizeAppNames：超过 50 个时截断并在末尾补「… and N more」。

function sanitizeTrustedNames(raw: readonly string[]): string[] {
  return sanitizeCore(raw, false)
}
// sanitizeTrustedNames：可信名不过字符过滤。

/**
 * Filter raw Spotlight results to user-facing apps, then sanitize. Always-keep
 * apps bypass path/name filter AND char allowlist (trusted vendors, not
 * attacker-installed); still length-capped, deduped, sorted.
 */
export function filterAppsForDescription(
  installed: readonly InstalledAppLike[],
  homeDir: string | undefined,
): string[] {
  const { alwaysKept, rest } = installed.reduce<{
    alwaysKept: string[]
    rest: string[]
  }>(
    (acc, app) => {
      if (ALWAYS_KEEP_BUNDLE_IDS.has(app.bundleId)) {
        acc.alwaysKept.push(app.displayName)
      } else if (
        isUserFacingPath(app.path, homeDir) &&
        !isNoisyName(app.displayName)
      ) {
        acc.rest.push(app.displayName)
      }
      return acc
    },
    { alwaysKept: [], rest: [] },
  )

  const sanitizedAlways = sanitizeTrustedNames(alwaysKept)
  const alwaysSet = new Set(sanitizedAlways)
  return [
    ...sanitizedAlways,
    ...sanitizeAppNames(rest).filter(n => !alwaysSet.has(n)),
  ]
}
// filterAppsForDescription：对外主入口，把 installed 分流为 alwaysKept（可信，绕过路径与字符过滤）与 rest（按路径与噪声名过滤），两套各自净化后合并去重返回。
