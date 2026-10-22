/**
 * Leaf state module for the remote-managed-settings sync cache.
 *
 * Split from syncCache.ts to break the settings.ts → syncCache.ts → auth.ts →
 * settings.ts cycle. auth.ts sits inside the large settings SCC; importing it
 * from settings.ts's own dependency chain pulls hundreds of modules into the
 * eagerly-evaluated SCC at startup.
 *
 * This module imports only leaves (path, envUtils, file, json, types,
 * settings/settingsCache — also a leaf, only type-imports validation). settings.ts
 * reads the cache from here. syncCache.ts keeps isRemoteManagedSettingsEligible
 * (the auth-touching part) and re-exports everything from here for callers that
 * don't care about the cycle.
 *
 * Eligibility is a tri-state here: undefined (not yet determined — return
 * null), false (ineligible — return null), true (proceed). managedEnv.ts
 * calls isRemoteManagedSettingsEligible() just before the policySettings
 * read — after userSettings/flagSettings env vars are applied, so the check
 * sees config-provided CLAUDE_CODE_USE_BEDROCK/ANTHROPIC_BASE_URL. That call
 * computes once and mirrors the result here via setEligibility(). Every
 * subsequent read hits the cached bool instead of re-running the auth chain.
 */

// 这个文件是纯叶子：只 import path / envUtils / file / json / settingsCache 这些不碰 auth 的模块。
// 拆出来的动机写在文件头——settings.ts → syncCache.ts → auth.ts → settings.ts 这个环，
// auth.ts 坐在大的 settings SCC 里，从 settings.ts 自己的依赖链 import 它会把几百个模块
// 拉进启动期（eagerly-evaluated）的 SCC。拆开后 settings.ts 从叶子读缓存，环就断了。
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { readFileSync } from '../../utils/fileRead.js'
import { stripBOM } from '../../utils/jsonRead.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { jsonParse } from '../../utils/slowOperations.js'

const SETTINGS_FILENAME = 'remote-settings.json'

// 缓存文件名 remote-settings.json，放在 Claude config home 下（~/.claude/ 一类）。
// 两个模块级状态：sessionCache（本次进程的设置快照）和 eligible（三态资格镜像）。
let sessionCache: SettingsJson | null = null
let eligible: boolean | undefined
// eligible 是三态而不是布尔：undefined = 还没判定过（读取时返回 null，不瞎猜）、
// false = 判定不合格、true = 放行。为什么需要 undefined：
// managedEnv.ts 在 policySettings 读取前一刻才调 isRemoteManagedSettingsEligible()，
// 那时 userSettings/flagSettings 的环境变量已经应用，检查能看到 config 提供的
// CLAUDE_CODE_USE_BEDROCK / ANTHROPIC_BASE_URL——判定时机比「启动时」晚，是有意的。

export function setSessionCache(value: SettingsJson | null): void {
  sessionCache = value
}

export function resetSyncCache(): void {
  sessionCache = null
  eligible = undefined
}

export function setEligibility(v: boolean): boolean {
  eligible = v
  return v
}
// setEligibility 把判定结果 mirror 进叶子并原样返回——就是为了让 syncCache.ts 能写
// return (cached = setEligibility(x)) 这种一行双存的惯用法（见该文件 112 行）。

export function getSettingsPath(): string {
  return join(getClaudeConfigHomeDir(), SETTINGS_FILENAME)
}
// getSettingsPath 每次现拼（不缓存）——config home 可能被测试改来改去，缓存路径会踩到别的水准下。

// sync IO — settings pipeline is sync. fileRead and jsonRead are leaves;
// file.ts and json.ts both sit in the settings SCC.
function loadSettings(): SettingsJson | null {
  try {
    const content = readFileSync(getSettingsPath())
    const data: unknown = jsonParse(stripBOM(content))
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null
    }
    return data as SettingsJson
  } catch {
    return null
  }
}
// loadSettings 是同步 IO：settings 管线整体是同步的（getSettings() 到处被同步调用），
// 异步化代价太大。注释点明了为什么用 fileRead/jsonRead 而不是 file.ts/json.ts——
// 后两个坐在 settings SCC 里，从叶子 import 它们等于把环再请回来。
// 任何异常（不存在/坏 JSON/不是对象）都归一到 null：缓存读不出来就当没有。

// getRemoteManagedSettingsSyncFromCache 是全子系统唯一的读取入口，settings.ts 和 index.ts 都走它。
// 内部顺序：三态门 → 进程内缓存 → 读盘 → 首次命中时冲合并缓存。
export function getRemoteManagedSettingsSyncFromCache(): SettingsJson | null {
  if (eligible !== true) return null
// 三态门：eligible 不是 true 就返回 null。undefined（没判定过）和 false（不合格）对读取方是同一回事——
// 都表示「现在没有远程设置可用」。注意这句也防了「判定前误读」。
  if (sessionCache) return sessionCache
  const cachedSettings = loadSettings()
  if (cachedSettings) {
    sessionCache = cachedSettings
    // Remote settings just became available for the first time. Any merged
    // getSettings_DEPRECATED() result cached before this moment is missing
    // the policySettings layer (the `eligible !== true` guard above returned
    // null). Flush so the next merged read re-merges with this layer visible.
    //
    // Fires at most once: subsequent calls hit `if (sessionCache)` above.
    // When called from loadSettingsFromDisk() (settings.ts:546), the merged
    // cache is still null (setSessionSettingsCache runs at :732 after
    // loadSettingsFromDisk returns) — no-op. The async-fetch arm (index.ts
    // setSessionCache + notifyChange) already handles its own reset.
    //
    // gh-23085: isBridgeEnabled() at main.tsx Commander-definition time
    // (before preAction → init() → isRemoteManagedSettingsEligible()) reached
    // getSettings_DEPRECATED() at auth.ts:115. The try/catch in bridgeEnabled
    // swallowed the later getGlobalConfig() throw, but the merged settings
    // cache was already poisoned. See managedSettingsHeadless.int.test.ts.
    resetSettingsCache()
    return cachedSettings
  }
  return null
}
// 第一次从磁盘读到远程设置时，必须 resetSettingsCache() 冲掉已合并的缓存。原因：
// 在此之前（eligible 还不是 true）任何 getSettings_DEPRECATED() 的合并结果都缺 policySettings 这一层，
// 不冲掉的话下游会一直用那份「缺层」的合并结果。
// 最多触发一次（之后命中上面的 sessionCache 分支）。
// 注释里记了 gh-23085：isBridgeEnabled() 在 main.tsx Commander 定义阶段（早于 preAction → init() →
// isRemoteManagedSettingsEligible()）就在 auth.ts:115 调了 getSettings_DEPRECATED()，
// bridgeEnabled 的 try/catch 吞了后来 getGlobalConfig() 的抛错，但合并缓存已被污染——
// 这个 reset 就是堵这个洞的补丁，回归测试在 managedSettingsHeadless.int.test.ts。
