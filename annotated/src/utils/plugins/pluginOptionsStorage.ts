// 本文件：插件「用户可配置选项」的存储与变量替换。插件在 `manifest.userConfig` 里声明字段；启用时按 `sensitive` 分流——敏感项进 secureStorage（macOS 走钥匙串，其它平台写 `.credentials.json`），其余进 `settings.json` 的 `pluginConfigs[pluginId].options`。`loadPluginOptions` 把两边合并读出，替换辅助函数也放这里，避免 hooks/LSP/skills 都去依赖 MCP 专属代码。
/**
 * Plugin option storage and substitution.
 *
 * Plugins declare user-configurable options in `manifest.userConfig` — a record
 * of field schemas matching `McpbUserConfigurationOption`. At enable time the
 * user is prompted for values. Storage splits by `sensitive`:
 *   - `sensitive: true`  → secureStorage (keychain on macOS, .credentials.json elsewhere)
 *   - everything else    → settings.json `pluginConfigs[pluginId].options`
 *
 * `loadPluginOptions` reads and merges both. The substitution helpers are also
 * here (moved from mcpPluginIntegration.ts) so hooks/LSP/skills don't all
 * import from MCP-specific code.
 */

// `lodash-es` 的 `memoize`：下面 `loadPluginOptions` 用它做按 pluginId 的记忆化，避免每次工具调用都读设置 + 拉钥匙串。
import memoize from 'lodash-es/memoize.js'
import type { LoadedPlugin } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'
import { getSecureStorage } from '../secureStorage/index.js'
import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '../settings/settings.js'
import {
  type UserConfigSchema,
  type UserConfigValues,
  validateUserConfig,
} from './mcpbHandler.js'
import { getPluginDataDir } from './pluginDirectories.js'
// 导入 `getPluginDataDir`：插件持久数据目录，供 `${CLAUDE_PLUGIN_DATA}` 变量替换使用。

export type PluginOptionValues = UserConfigValues
// 类型别名：`PluginOptionValues` 就是已填值的记录（键→值）。
export type PluginOptionSchema = UserConfigSchema
// 类型别名：`PluginOptionSchema` 是字段 schema 记录（键→字段定义，含是否敏感）。

/**
 * Canonical storage key for a plugin's options in both `settings.pluginConfigs`
 * and `secureStorage.pluginSecrets`. Today this is `plugin.source` — always
 * `"${name}@${marketplace}"` (pluginLoader.ts:1400). `plugin.repository` is
 * a backward-compat alias that's set to the same string (1401); don't use it
 * for storage. UI code that manually constructs `` `${name}@${marketplace}` ``
 * produces the same key by convention — see PluginOptionsFlow, ManagePlugins.
 *
 * Exists so there's exactly one place to change if the key format ever drifts.
 */
// `getPluginStorageId`：返回某插件选项在 `settings` 与 `secureStorage` 里的规范存储键。目前就是 `plugin.source`（形如 `name@marketplace`）；`plugin.repository` 只是向后兼容别名，别用于存储。
export function getPluginStorageId(plugin: LoadedPlugin): string {
  return plugin.source
// 直接返回 `plugin.source`——全仓只有这一处定义存储键格式，要改只改这里。
}

/**
 * Load saved option values for a plugin, merging non-sensitive (from settings)
 * with sensitive (from secureStorage). SecureStorage wins on key collision.
 *
 * Memoized per-pluginId because hooks can fire per-tool-call and each call
 * would otherwise do a settings read + keychain spawn. Cache cleared via
 * `clearPluginOptionsCache` when settings change or plugins reload.
 */
// `loadPluginOptions`：记忆化的选项读取器，合并非敏感（来自 settings）与敏感（来自 secureStorage）两项；键冲突时 secureStorage 优先。
export const loadPluginOptions = memoize(
  (pluginId: string): PluginOptionValues => {
    const settings = getSettings_DEPRECATED()
// 读 merged 设置里的非敏感部分；没有就回退空对象。
    const nonSensitive =
      settings.pluginConfigs?.[pluginId]?.options ?? ({} as PluginOptionValues)

    // NOTE: storage.read() spawns `security find-generic-password` on macOS
    // (~50-100ms, synchronous). Mitigated by the memoize above (per-pluginId,
    // session-lifetime) + keychain's own 30s TTL cache — so one blocking spawn
    // per session per plugin-with-options. /reload-plugins clears the memoize
    // and the next hook/MCP-load after that eats a fresh spawn.
    const storage = getSecureStorage()
// 读 secureStorage：macOS 上 `storage.read()` 会 spawn `security find-generic-password`（约 50-100ms 同步阻塞），靠上面的 memoize + 钥匙串自身 30s TTL 把开销压到每会话每插件一次。
    const sensitive =
      storage.read()?.pluginSecrets?.[pluginId] ??
      ({} as Record<string, string>)

    // secureStorage wins on collision — schema determines destination so
    // collision shouldn't happen, but if a user hand-edits settings.json we
    // trust the more secure source.
    return { ...nonSensitive, ...sensitive }
// 合并返回——敏感项覆盖同名非敏感项；schema 决定去向本不应冲突，但用户手改 settings.json 时以更安全的来源为准。
  },
)

// `clearPluginOptionsCache`：清空 `loadPluginOptions` 的记忆化缓存；设置变更或插件重载时调用，让下次读取看到新值。
export function clearPluginOptionsCache(): void {
  loadPluginOptions.cache?.clear?.()
}

/**
 * Save option values, splitting by `schema[key].sensitive`. Non-sensitive go
 * to userSettings; sensitive go to secureStorage. Writes are skipped if nothing
 * in that category is present.
 *
 * Clears the load cache on success so the next `loadPluginOptions` sees fresh.
 */
// `savePluginOptions`：按 `schema[key].sensitive` 把值拆成两类，非敏感写用户设置、敏感写 secureStorage；某一类无内容就跳过写入。成功后清读取缓存。
export function savePluginOptions(
  pluginId: string,
  values: PluginOptionValues,
  schema: PluginOptionSchema,
): void {
  const nonSensitive: PluginOptionValues = {}
  const sensitive: Record<string, string> = {}

  for (const [key, value] of Object.entries(values)) {
// 遍历每条值：`sensitive` 为真进敏感表，否则进非敏感表。
    if (schema[key]?.sensitive === true) {
      sensitive[key] = String(value)
    } else {
      nonSensitive[key] = value
    }
  }

  // Scrub sets — see saveMcpServerUserConfig (mcpbHandler.ts) for the
  // rationale. Only keys in THIS save are scrubbed from the other store,
  // so partial reconfigures don't lose data.
  const sensitiveKeysInThisSave = new Set(Object.keys(sensitive))
// 记录「本次保存涉及哪些键」，用于从另一份存储里擦除同名旧键，避免局部重配丢失数据。
  const nonSensitiveKeysInThisSave = new Set(Object.keys(nonSensitive))

  // secureStorage FIRST — if keychain fails, throw before touching
  // settings.json so old plaintext (if any) stays as fallback.
  const storage = getSecureStorage()
// 先取 secureStorage 句柄——下面先写敏感项，失败就提前抛错、不碰 settings.json，保留旧明文作兜底。
  const existingInSecureStorage =
    storage.read()?.pluginSecrets?.[pluginId] ?? undefined
  const secureScrubbed = existingInSecureStorage
    ? Object.fromEntries(
        Object.entries(existingInSecureStorage).filter(
          ([k]) => !nonSensitiveKeysInThisSave.has(k),
        ),
      )
    : undefined
  const needSecureScrub =
    secureScrubbed &&
    existingInSecureStorage &&
    Object.keys(secureScrubbed).length !==
      Object.keys(existingInSecureStorage).length
  if (Object.keys(sensitive).length > 0 || needSecureScrub) {
// 只有当有敏感项要写、或需从 settings 擦除同名敏感键时才动 secureStorage。
    const existing = storage.read() ?? {}
    if (!existing.pluginSecrets) {
      existing.pluginSecrets = {}
    }
    existing.pluginSecrets[pluginId] = {
      ...secureScrubbed,
      ...sensitive,
    }
    const result = storage.update(existing)
// 把擦除后的敏感项写回 secureStorage。
    if (!result.success) {
// 写入失败：记日志并抛错，让调用方知道敏感项没存上。
      const err = new Error(
        `Failed to save sensitive plugin options for ${pluginId} to secure storage`,
      )
      logError(err)
      throw err
    }
    if (result.warning) {
// 写入有警告（非失败）时记到调试日志。
      logForDebugging(`Plugin secrets save warning: ${result.warning}`, {
        level: 'warn',
      })
    }
  }

  // settings.json AFTER secureStorage — scrub sensitive keys via explicit
  // undefined (mergeWith deletion pattern).
  //
  // TODO: getSettings_DEPRECATED returns MERGED settings across all scopes.
  // Mutating that and writing to userSettings can leak project-scope
  // pluginConfigs into ~/.claude/settings.json. Same pattern exists in
  // saveMcpServerUserConfig. Safe today since pluginConfigs is only ever
  // written here (user-scope), but will bite if we add project-scoped
  // plugin options.
  const settings = getSettings_DEPRECATED()
// settings 侧：取 merged 设置里的非敏感部分；注意 `getSettings_DEPRECATED` 返回跨作用域合并结果，写到 userSettings 可能把项目级 pluginConfigs 漏进 `~/.claude/settings.json`（已知隐患，见下方 TODO）。
  const existingInSettings = settings.pluginConfigs?.[pluginId]?.options ?? {}
  const keysToScrubFromSettings = Object.keys(existingInSettings).filter(k =>
    sensitiveKeysInThisSave.has(k),
  )
  if (
    Object.keys(nonSensitive).length > 0 ||
    keysToScrubFromSettings.length > 0
  ) {
    if (!settings.pluginConfigs) {
      settings.pluginConfigs = {}
    }
    if (!settings.pluginConfigs[pluginId]) {
      settings.pluginConfigs[pluginId] = {}
    }
    const scrubbed = Object.fromEntries(
      keysToScrubFromSettings.map(k => [k, undefined]),
    ) as Record<string, undefined>
    settings.pluginConfigs[pluginId].options = {
      ...nonSensitive,
      ...scrubbed,
    } as PluginOptionValues
    const result = updateSettingsForSource('userSettings', settings)
// 把非敏感项（含用 `undefined` 显式擦除的敏感键）写回 userSettings；失败记日志并抛错。
    if (result.error) {
      logError(result.error)
      throw new Error(
        `Failed to save plugin options for ${pluginId}: ${result.error.message}`,
      )
    }
  }

  clearPluginOptionsCache()
// 保存成功后清读取缓存，保证下次 `loadPluginOptions` 拿到新值。
}

/**
 * Delete all stored option values for a plugin — both the non-sensitive
 * `settings.pluginConfigs[pluginId]` entry and the sensitive
 * `secureStorage.pluginSecrets[pluginId]` entry.
 *
 * Call this when the LAST installation of a plugin is uninstalled (i.e.,
 * alongside `markPluginVersionOrphaned`). Don't call on every uninstall —
 * a plugin can be installed in multiple scopes and the user's config should
 * survive removing it from one scope while it remains in another.
 *
 * Best-effort: keychain write failure is logged but doesn't throw, since
 * the uninstall itself succeeded and we don't want to surface a confusing
 * "uninstall failed" message for a cleanup side-effect.
 */
// `deletePluginOptions`：删除某插件全部已存选项（settings 侧 + secureStorage 侧）。在插件「最后一个安装」被卸载时调用；不要每次卸载都调——多作用域安装时配置应在其它作用域保留。
export function deletePluginOptions(pluginId: string): void {
  // Settings side — also wipes the legacy mcpServers sub-key (same story:
  // orphaned on uninstall, never cleaned up before this PR).
  //
  // Use `undefined` (not `delete`) because `updateSettingsForSource` merges
  // via `mergeWith` — absent keys are ignored, only `undefined` triggers
  // removal. Cast is deliberate (CLAUDE.md's 10% case): adding z.undefined()
  // to the schema instead (like enabledPlugins:466 does) leaks
  // `| {[k: string]: unknown}` into the public SDK type, which subsumes the
  // real object arm and kills excess-property checks for SDK consumers. The
  // mergeWith-deletion contract is internal plumbing — it shouldn't shape
  // the Zod schema. enabledPlugins gets away with it only because its other
  // arms (string[] | boolean) are non-objects that stay distinct.
  const settings = getSettings_DEPRECATED()
// settings 侧：用 `undefined`（而非 `delete`）触发 `mergeWith` 的删除语义；同时清掉遗留的 `mcpServers` 旧子键。
  type PluginConfigs = NonNullable<typeof settings.pluginConfigs>
  if (settings.pluginConfigs?.[pluginId]) {
    // Partial<Record<K,V>> = Record<K, V | undefined> — gives us the widening
    // for the undefined value, and Partial-of-X overlaps with X so the cast
    // is a narrowing TS accepts (same approach as marketplaceManager.ts:1795).
    const pluginConfigs: Partial<PluginConfigs> = { [pluginId]: undefined }
// `Partial<Record<K,V>>` 给 `undefined` 值提供拓宽，配合 `as` 收窄让 TS 接受这种「键→可能为 undefined」的写法。
    const { error } = updateSettingsForSource('userSettings', {
// 写回 userSettings 清除该插件的 pluginConfigs 项；失败只记调试日志（卸载本身已成功，不当面报错）。
      pluginConfigs: pluginConfigs as PluginConfigs,
    })
    if (error) {
      logForDebugging(
        `deletePluginOptions: failed to clear settings.pluginConfigs[${pluginId}]: ${error.message}`,
        { level: 'warn' },
      )
    }
  }

  // Secure storage side — delete both the top-level pluginSecrets[pluginId]
  // and any per-server composite keys `${pluginId}/${server}` (from
  // saveMcpServerUserConfig's sensitive split). `/` prefix match is safe:
  // plugin IDs are `name@marketplace`, never contain `/`, so
  // startsWith(`${id}/`) can't false-positive on a different plugin.
  const storage = getSecureStorage()
// secureStorage 侧：删掉 `pluginSecrets[pluginId]` 以及每个 server 的复合键 `pluginId/server`（来自敏感拆分）。
  const existing = storage.read()
  if (existing?.pluginSecrets) {
    const prefix = `${pluginId}/`
    const survivingEntries = Object.entries(existing.pluginSecrets).filter(
// 用 startsWith 做「以 pluginId 加斜杠为前缀」的匹配：插件 ID 形如 name@marketplace 不含斜杠，不会误伤别的插件。
      ([k]) => k !== pluginId && !k.startsWith(prefix),
    )
    if (
      survivingEntries.length !== Object.keys(existing.pluginSecrets).length
    ) {
      const result = storage.update({
        ...existing,
        pluginSecrets:
          survivingEntries.length > 0
            ? Object.fromEntries(survivingEntries)
            : undefined,
      })
      if (!result.success) {
        logForDebugging(
          `deletePluginOptions: failed to clear pluginSecrets for ${pluginId} from keychain`,
          { level: 'warn' },
        )
      }
    }
  }

  clearPluginOptionsCache()
// 删除完成后同样清读取缓存。
}

/**
 * Find option keys whose saved values don't satisfy the schema — i.e., what to
 * prompt for. Returns the schema slice for those keys, or empty if everything
 * validates. Empty manifest.userConfig → empty result.
 *
 * Used by PluginOptionsFlow to decide whether to show the prompt after enable.
 */
// `getUnconfiguredOptions`：找出「已存值不满足 schema」的键——即启用后要追问用户哪些项。返回这些键的 schema 切片；空 manifest 或全通过则返回空。
export function getUnconfiguredOptions(
  plugin: LoadedPlugin,
): PluginOptionSchema {
  const manifestSchema = plugin.manifest.userConfig
  if (!manifestSchema || Object.keys(manifestSchema).length === 0) {
    return {}
  }

  const saved = loadPluginOptions(getPluginStorageId(plugin))
// 读已存选项并整体校验；通过就无需追问。
  const validation = validateUserConfig(saved, manifestSchema)
  if (validation.valid) {
    return {}
  }

  // Return only the fields that failed. validateUserConfig reports errors as
  // strings keyed by title/key — simpler to just re-check each field here than
  // parse error strings.
  const unconfigured: PluginOptionSchema = {}
// 逐字段重校验：只收集失败字段的 schema 切片返回，比解析错误信息字符串更稳。
  for (const [key, fieldSchema] of Object.entries(manifestSchema)) {
    const single = validateUserConfig(
      { [key]: saved[key] } as PluginOptionValues,
      { [key]: fieldSchema },
    )
    if (!single.valid) {
      unconfigured[key] = fieldSchema
    }
  }
  return unconfigured
}

/**
 * Substitute ${CLAUDE_PLUGIN_ROOT} and ${CLAUDE_PLUGIN_DATA} with their paths.
 * On Windows, normalizes backslashes to forward slashes so shell commands
 * don't interpret them as escape characters.
 *
 * ${CLAUDE_PLUGIN_ROOT} — version-scoped install dir (recreated on update)
 * ${CLAUDE_PLUGIN_DATA} — persistent state dir (survives updates)
 *
 * Both patterns use the function-replacement form of .replace(): ROOT so
 * `$`-patterns in NTFS paths ($$, $', $`, $&) aren't interpreted; DATA so
 * getPluginDataDir (which lazily mkdirs) only runs when actually present.
 *
 * Used in MCP/LSP server command/args/env, hook commands, skill/agent content.
 */
// `substitutePluginVariables`：把 `${CLAUDE_PLUGIN_ROOT}`（版本作用域安装目录）与 `${CLAUDE_PLUGIN_DATA}`（持久状态目录）替换成真实路径；Windows 上把反斜杠归一为正斜杠，避免 shell 把反斜杠当成转义字符。
export function substitutePluginVariables(
  value: string,
  plugin: { path: string; source?: string },
): string {
  const normalize = (p: string) =>
    process.platform === 'win32' ? p.replace(/\\/g, '/') : p
  let out = value.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, () =>
// ROOT 替换用函数式 `.replace()`：避免 NTFS 路径里的 `$` 模式（$$ $' $` $&）被当成替换符。
    normalize(plugin.path),
  )
  // source can be absent (e.g. hooks where pluginRoot is a skill root without
  // a plugin context). In that case ${CLAUDE_PLUGIN_DATA} is left literal.
  if (plugin.source) {
// 只有 `plugin.source` 存在才替换 DATA：hooks 里 pluginRoot 可能只是 skill 根、没有插件上下文，此时 DATA 保持字面量。
    const source = plugin.source
    out = out.replace(/\$\{CLAUDE_PLUGIN_DATA\}/g, () =>
      normalize(getPluginDataDir(source)),
    )
  }
  return out
}

/**
 * Substitute ${user_config.KEY} with saved option values.
 *
 * Throws on missing keys — callers pass this only after `validateUserConfig`
 * succeeded, so a miss here means a plugin references a key it never declared
 * in its schema. That's a plugin authoring bug; failing loud surfaces it.
 *
 * Use `substituteUserConfigInContent` for skill/agent prose — it handles
 * missing keys and sensitive-filtering instead of throwing.
 */
// `substituteUserConfigVariables`：把 `${user_config.KEY}` 替换成已存选项值。键缺失直接抛错——调用方保证先过 `validateUserConfig`，缺失说明插件引用了未声明的键，属插件作者 bug，响亮失败才暴露。
export function substituteUserConfigVariables(
  value: string,
  userConfig: PluginOptionValues,
): string {
  return value.replace(/\$\{user_config\.([^}]+)\}/g, (_match, key) => {
// 正则替换每个 `${user_config.键}`；命中即返回对应字符串值。
    const configValue = userConfig[key]
    if (configValue === undefined) {
// 键对应值缺失：抛错，要求「替换前必已校验」。
      throw new Error(
        `Missing required user configuration value: ${key}. ` +
          `This should have been validated before variable substitution.`,
      )
    }
    return String(configValue)
  })
}

/**
 * Content-safe variant for skill/agent prose. Differences from
 * `substituteUserConfigVariables`:
 *
 *   - Sensitive-marked keys substitute to a descriptive placeholder instead of
 *     the actual value — skill/agent content goes to the model prompt, and
 *     we don't put secrets in the model's context.
 *   - Unknown keys stay literal (no throw) — matches how `${VAR}` env refs
 *     behave today when the var is unset.
 *
 * A ref to a sensitive key produces obvious-looking output so plugin authors
 * notice and move the ref into a hook/MCP env instead.
 */
// `substituteUserConfigInContent`：给 skill/agent 正文用的「内容安全版」替换，与上一个的差异——敏感键替换成占位说明（不把密钥送进模型上下文）、未知键保持字面量不抛错。
export function substituteUserConfigInContent(
  content: string,
  options: PluginOptionValues,
  schema: PluginOptionSchema,
): string {
  return content.replace(/\$\{user_config\.([^}]+)\}/g, (match, key) => {
// 逐处替换 `${user_config.键}`：敏感键给占位、缺值保持原样、否则给真实值。
    if (schema[key]?.sensitive === true) {
// 敏感键：替换成「该选项在 skill 内容中不可用」的占位，提醒作者把引用挪到 hook/MCP 的环境变量里。
      return `[sensitive option '${key}' not available in skill content]`
    }
    const value = options[key]
    if (value === undefined) {
// 未知键：保留 `${user_config.键}` 字面量（与未设置环境变量时的 `${VAR}` 行为一致），不抛错。
      return match
    }
    return String(value)
  })
}
