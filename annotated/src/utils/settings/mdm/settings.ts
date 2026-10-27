/**
 * MDM (Mobile Device Management) profile enforcement for Claude Code managed settings.
 *
 * Reads enterprise settings from OS-level MDM configuration:
 * - macOS: `com.anthropic.claudecode` preference domain
 *   (MDM profiles at /Library/Managed Preferences/ only — not user-writable ~/Library/Preferences/)
 * - Windows: `HKLM\SOFTWARE\Policies\ClaudeCode` (admin-only)
 *   and `HKCU\SOFTWARE\Policies\ClaudeCode` (user-writable, lowest priority)
 * - Linux: No MDM equivalent (uses /etc/claude-code/managed-settings.json instead)
 *
 * Policy settings use "first source wins" — the highest-priority source that exists
 * provides all policy settings. Priority (highest to lowest):
 *   remote → HKLM/plist → managed-settings.json → HKCU
 *
 * Architecture:
 *   constants.ts — shared constants and plist path builder (zero heavy imports)
 *   rawRead.ts   — subprocess I/O only (zero heavy imports, fires at main.tsx evaluation)
 *   settings.ts  — parsing, caching, first-source-wins logic (this file)
 */
// MDM 企业配置强制读取，按「首个存在的源胜出」策略合并，优先级 remote → HKLM/plist → managed-settings.json → HKCU。

import { join } from 'path'
import { logForDebugging } from '../../debug.js'
import { logForDiagnosticsNoPII } from '../../diagLogs.js'
import { readFileSync } from '../../fileRead.js'
import { getFsImplementation } from '../../fsOperations.js'
import { safeParseJSON } from '../../json.js'
import { profileCheckpoint } from '../../startupProfiler.js'
import {
  getManagedFilePath,
  getManagedSettingsDropInDir,
} from '../managedPath.js'
import { type SettingsJson, SettingsSchema } from '../types.js'
import {
  filterInvalidPermissionRules,
  formatZodError,
  type ValidationError,
} from '../validation.js'
import {
  WINDOWS_REGISTRY_KEY_PATH_HKCU,
  WINDOWS_REGISTRY_KEY_PATH_HKLM,
  WINDOWS_REGISTRY_VALUE_NAME,
} from './constants.js'
import {
  fireRawRead,
  getMdmRawReadPromise,
  type RawReadResult,
} from './rawRead.js'

// ---------------------------------------------------------------------------
// Types and cache
// ---------------------------------------------------------------------------

type MdmResult = { settings: SettingsJson; errors: ValidationError[] }
const EMPTY_RESULT: MdmResult = Object.freeze({ settings: {}, errors: [] })
let mdmCache: MdmResult | null = null
let hkcuCache: MdmResult | null = null
let mdmLoadPromise: Promise<void> | null = null

// ---------------------------------------------------------------------------
// Startup load — fires early, awaited before first settings read
// ---------------------------------------------------------------------------

/**
 * Kick off async MDM/HKCU reads. Call this as early as possible in
 * startup so the subprocess runs in parallel with module loading.
 */
export function startMdmSettingsLoad(): void {
  if (mdmLoadPromise) return
  mdmLoadPromise = (async () => {
    profileCheckpoint('mdm_load_start')
    const startTime = Date.now()

    // Use the startup raw read if cli.tsx fired it, otherwise fire a fresh one.
    // Both paths produce the same RawReadResult; consumeRawReadResult parses it.
    const rawPromise = getMdmRawReadPromise() ?? fireRawRead()
    const { mdm, hkcu } = consumeRawReadResult(await rawPromise)
    mdmCache = mdm
    hkcuCache = hkcu
    profileCheckpoint('mdm_load_end')

    const duration = Date.now() - startTime
    logForDebugging(`MDM settings load completed in ${duration}ms`)
    if (Object.keys(mdm.settings).length > 0) {
      logForDebugging(
        `MDM settings found: ${Object.keys(mdm.settings).join(', ')}`,
      )
      try {
        logForDiagnosticsNoPII('info', 'mdm_settings_loaded', {
          duration_ms: duration,
          key_count: Object.keys(mdm.settings).length,
          error_count: mdm.errors.length,
        })
      } catch {
        // Diagnostic logging is best-effort
      }
    }
  })()
}
// 启动期尽量早触发 MDM/HKCU 的异步子进程读取，与模块加载并行，首个设置读取前 await。

/**
 * Await the in-flight MDM load. Call this before the first settings read.
 * If startMdmSettingsLoad() was called early enough, this resolves immediately.
 */
export async function ensureMdmSettingsLoaded(): Promise<void> {
  if (!mdmLoadPromise) {
    startMdmSettingsLoad()
  }
  await mdmLoadPromise
}
// 等待在途的 MDM 加载完成，若尚未启动则先触发。

// ---------------------------------------------------------------------------
// Sync cache readers — used by the settings pipeline (loadSettingsFromDisk)
// ---------------------------------------------------------------------------

/**
 * Read admin-controlled MDM settings from the session cache.
 *
 * Returns settings from admin-only sources:
 * - macOS: /Library/Managed Preferences/ (requires root)
 * - Windows: HKLM registry (requires admin)
 *
 * Does NOT include HKCU (user-writable) — use getHkcuSettings() for that.
 */
export function getMdmSettings(): MdmResult {
  return mdmCache ?? EMPTY_RESULT
}
// 返回仅含管理员来源（macOS 受管目录 / Windows HKLM）的设置，不含用户级 HKCU。

/**
 * Read HKCU registry settings (user-writable, lowest policy priority).
 * Only relevant on Windows — returns empty on other platforms.
 */
export function getHkcuSettings(): MdmResult {
  return hkcuCache ?? EMPTY_RESULT
}
// 读取用户级 HKCU 注册表，仅 Windows 有意义，其他平台返回空。

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

/**
 * Clear the MDM and HKCU settings caches, forcing a fresh read on next load.
 */
export function clearMdmSettingsCache(): void {
  mdmCache = null
  hkcuCache = null
  mdmLoadPromise = null
}
// 清空 MDM 与 HKCU 缓存并重置加载承诺，迫使下次刷新重新读取。

/**
 * Update the session caches directly. Used by the change detector poll.
 */
export function setMdmSettingsCache(mdm: MdmResult, hkcu: MdmResult): void {
  mdmCache = mdm
  hkcuCache = hkcu
}

// ---------------------------------------------------------------------------
// Refresh — fires a fresh raw read, parses, returns results.
// Used by the 30-minute poll in changeDetector.ts.
// ---------------------------------------------------------------------------

/**
 * Fire a fresh MDM subprocess read and parse the results.
 * Does NOT update the cache — caller decides whether to apply.
 */
export async function refreshMdmSettings(): Promise<{
  mdm: MdmResult
  hkcu: MdmResult
}> {
  const raw = await fireRawRead()
  return consumeRawReadResult(raw)
}
// 重新发起一次 MDM 子进程读取并解析，但不写缓存，由调用方决定是否应用。

// ---------------------------------------------------------------------------
// Parsing — converts raw subprocess output to validated MdmResult
// ---------------------------------------------------------------------------

/**
 * Parse JSON command output (plutil stdout or registry JSON value) into SettingsJson.
 * Filters invalid permission rules before schema validation so one bad rule
 * doesn't cause the entire MDM settings to be rejected.
 */
export function parseCommandOutputAsSettings(
  stdout: string,
  sourcePath: string,
): { settings: SettingsJson; errors: ValidationError[] } {
  const data = safeParseJSON(stdout, false)
  if (!data || typeof data !== 'object') {
    return { settings: {}, errors: [] }
  }

  const ruleWarnings = filterInvalidPermissionRules(data, sourcePath)
  const parseResult = SettingsSchema().safeParse(data)
  if (!parseResult.success) {
    const errors = formatZodError(parseResult.error, sourcePath)
    return { settings: {}, errors: [...ruleWarnings, ...errors] }
  }
  return { settings: parseResult.data, errors: ruleWarnings }
}
// 把子进程 JSON 输出解析为 SettingsJson，先过滤非法权限规则再走 schema 校验，避免一条坏规则拖垮整份设置。

/**
 * Parse reg query stdout to extract a registry string value.
 * Matches both REG_SZ and REG_EXPAND_SZ, case-insensitive.
 *
 * Expected format:
 *     Settings    REG_SZ    {"json":"value"}
 */
export function parseRegQueryStdout(
  stdout: string,
  valueName = 'Settings',
): string | null {
  const lines = stdout.split(/\r?\n/)
  const escaped = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^\\s+${escaped}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, 'i')
  for (const line of lines) {
    const match = line.match(re)
    if (match && match[1]) {
      return match[1].trimEnd()
    }
  }
  return null
}
// 从 reg query 的标准输出里按正则抽取 REG_SZ / REG_EXPAND_SZ 字符串值，大小写不敏感。

/**
 * Convert raw subprocess output into parsed MDM and HKCU results,
 * applying the first-source-wins policy.
 */
function consumeRawReadResult(raw: RawReadResult): {
  mdm: MdmResult
  hkcu: MdmResult
} {
  // macOS: plist result (first source wins — already filtered in mdmRawRead)
  if (raw.plistStdouts && raw.plistStdouts.length > 0) {
    const { stdout, label } = raw.plistStdouts[0]!
    const result = parseCommandOutputAsSettings(stdout, label)
    if (Object.keys(result.settings).length > 0) {
      return { mdm: result, hkcu: EMPTY_RESULT }
    }
  }

  // Windows: HKLM result
  if (raw.hklmStdout) {
    const jsonString = parseRegQueryStdout(raw.hklmStdout)
    if (jsonString) {
      const result = parseCommandOutputAsSettings(
        jsonString,
        `Registry: ${WINDOWS_REGISTRY_KEY_PATH_HKLM}\\${WINDOWS_REGISTRY_VALUE_NAME}`,
      )
      if (Object.keys(result.settings).length > 0) {
        return { mdm: result, hkcu: EMPTY_RESULT }
      }
    }
  }

  // No admin MDM — check managed-settings.json before using HKCU
  if (hasManagedSettingsFile()) {
    return { mdm: EMPTY_RESULT, hkcu: EMPTY_RESULT }
  }

  // Fall through to HKCU (already read in parallel)
  if (raw.hkcuStdout) {
    const jsonString = parseRegQueryStdout(raw.hkcuStdout)
    if (jsonString) {
      const result = parseCommandOutputAsSettings(
        jsonString,
        `Registry: ${WINDOWS_REGISTRY_KEY_PATH_HKCU}\\${WINDOWS_REGISTRY_VALUE_NAME}`,
      )
      return { mdm: EMPTY_RESULT, hkcu: result }
    }
  }

  return { mdm: EMPTY_RESULT, hkcu: EMPTY_RESULT }
}
// 把原始子进程输出转成 MDM/HKCU 结果并套用「首个源胜出」策略，按 remote→HKLM→managed 文件→HKCU 顺序短路。

/**
 * Check if file-based managed settings (managed-settings.json or any
 * managed-settings.d/*.json) exist and have content. Cheap sync check
 * used to skip HKCU when a higher-priority file-based source exists.
 */
function hasManagedSettingsFile(): boolean {
  try {
    const filePath = join(getManagedFilePath(), 'managed-settings.json')
    const content = readFileSync(filePath)
    const data = safeParseJSON(content, false)
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      return true
    }
  } catch {
    // fall through to drop-in check
  }
  try {
    const dropInDir = getManagedSettingsDropInDir()
    const entries = getFsImplementation().readdirSync(dropInDir)
    for (const d of entries) {
      if (
        !(d.isFile() || d.isSymbolicLink()) ||
        !d.name.endsWith('.json') ||
        d.name.startsWith('.')
      ) {
        continue
      }
      try {
        const content = readFileSync(join(dropInDir, d.name))
        const data = safeParseJSON(content, false)
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          return true
        }
      } catch {
        // skip unreadable/malformed file
      }
    }
  } catch {
    // drop-in dir doesn't exist
  }
  return false
}
// 同步廉价检查受管设置文件（managed-settings.json 或 drop-in 目录）是否存在且有内容，用于更高优先级文件存在时跳过 HKCU。
