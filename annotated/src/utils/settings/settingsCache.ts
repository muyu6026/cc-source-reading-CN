import type { SettingSource } from './constants.js'
import type { SettingsJson } from './types.js'
import type { SettingsWithErrors, ValidationError } from './validation.js'

// 设置读取的三层缓存。第一层是合并后的会话级设置，第二层按来源分支缓存，第三层按文件路径缓存解析结果。三层共用一个重置入口，触发点包括设置写入、追加工作目录、插件初始化、钩子刷新。
let sessionSettingsCache: SettingsWithErrors | null = null

export function getSessionSettingsCache(): SettingsWithErrors | null {
  return sessionSettingsCache
}

export function setSessionSettingsCache(value: SettingsWithErrors): void {
  sessionSettingsCache = value
}

/**
 * Per-source cache for getSettingsForSource. Invalidated alongside the
 * merged sessionSettingsCache — same resetSettingsCache() triggers
 * (settings write, --add-dir, plugin init, hooks refresh).
 */
const perSourceCache = new Map<SettingSource, SettingsJson | null>()

export function getCachedSettingsForSource(
  source: SettingSource,
): SettingsJson | null | undefined {
  // undefined = cache miss; null = cached "no settings for this source"
  return perSourceCache.has(source) ? perSourceCache.get(source) : undefined
// 按来源查缓存用三态语义区分两种情况：没有这个键表示未命中，键存在但值为 null 表示「已确认该来源没有配置」。这样就不会把「确实空」和「还没查」混为一谈，避免反复回磁盘。
}

export function setCachedSettingsForSource(
  source: SettingSource,
  value: SettingsJson | null,
): void {
  perSourceCache.set(source, value)
}

/**
 * Path-keyed cache for parseSettingsFile. Both getSettingsForSource and
 * loadSettingsFromDisk call parseSettingsFile on the same paths during
 * startup — this dedupes the disk read + zod parse.
 */
type ParsedSettings = {
  settings: SettingsJson | null
  errors: ValidationError[]
}
const parseFileCache = new Map<string, ParsedSettings>()

export function getCachedParsedFile(path: string): ParsedSettings | undefined {
  return parseFileCache.get(path)
}
// 按路径的解析缓存键是文件绝对路径，值同时带上解析结果与校验错误。注释点明去重动机：启动阶段两个上层函数会对同一批路径各解析一遍，缓存把磁盘读取与 schema 校验合并成一次。

export function setCachedParsedFile(path: string, value: ParsedSettings): void {
  parseFileCache.set(path, value)
}

export function resetSettingsCache(): void {
  sessionSettingsCache = null
  perSourceCache.clear()
  parseFileCache.clear()
}
// 重置是「一刀切」的：清空会话级设置、按来源缓存、按路径解析缓存三者同时失效。因为设置变更会同时影响这三层，分开失效反而容易出现层间不一致。

/**
 * Plugin settings base layer for the settings cascade.
 * pluginLoader writes here after loading plugins;
 * loadSettingsFromDisk reads it as the lowest-priority base.
 */
let pluginSettingsBase: Record<string, unknown> | undefined

export function getPluginSettingsBase(): Record<string, unknown> | undefined {
  return pluginSettingsBase
}

export function setPluginSettingsBase(
  settings: Record<string, unknown> | undefined,
): void {
  pluginSettingsBase = settings
}

export function clearPluginSettingsBase(): void {
  pluginSettingsBase = undefined
}
// 插件设置基座是设置级联的最低优先级层：插件加载完后写入这里，磁盘设置在它之上叠加。这个值不走缓存失效流程，而是由插件生命周期单独清理，所以给了独立的读写与清除函数。
