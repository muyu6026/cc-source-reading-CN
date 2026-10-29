/**
 * Plugin-hint recommendations.
 *
 * Companion to lspRecommendation.ts: where LSP recommendations are triggered
 * by file edits, plugin hints are triggered by CLIs/SDKs emitting a
 * `<claude-code-hint />` tag to stderr (detected by the Bash/PowerShell tools).
 *
 * State persists in GlobalConfig.claudeCodeHints — a show-once record per
 * plugin and a disabled flag (user picked "don't show again"). Official-
 * marketplace filtering is hardcoded for v1.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../../services/analytics/index.js'
import {
  type ClaudeCodeHint,
  hasShownHintThisSession,
  setPendingHint,
} from '../claudeCodeHints.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { isPluginInstalled } from './installedPluginsManager.js'
import { getPluginById } from './marketplaceManager.js'
import {
  isOfficialMarketplaceName,
  parsePluginIdentifier,
} from './pluginIdentifier.js'
// 文件入口：插件安装提示推荐，由 CLI / SDK 输出的 claude-code-hint 标签触发。
import { isPluginBlockedByPolicy } from './pluginPolicy.js'

/**
 * Hard cap on `claudeCodeHints.plugin[]` — bounds config growth. Each shown
 * plugin appends one slug; past this point we stop prompting (and stop
 * appending) rather than let the config grow without limit.
 */
const MAX_SHOWN_PLUGINS = 100
// MAX_SHOWN_PLUGINS：限制已展示插件数量，防止配置无限增长。

export type PluginHintRecommendation = {
  pluginId: string
  pluginName: string
  marketplaceName: string
  pluginDescription?: string
  sourceCommand: string
}
// PluginHintRecommendation：渲染提示所需的插件元信息。

/**
 * Pre-store gate called by shell tools when a `type="plugin"` hint is detected.
 * Drops the hint if:
 *
 *  - a dialog has already been shown this session
 *  - user has disabled hints
 *  - the shown-plugins list has hit the config-growth cap
 *  - plugin slug doesn't parse as `name@marketplace`
 *  - marketplace isn't official (hardcoded for v1)
 *  - plugin is already installed
 *  - plugin was already shown in a prior session
 *
 * Synchronous on purpose — shell tools shouldn't await a marketplace lookup
 * just to strip a stderr line. The async marketplace-cache check happens
 * later in resolvePluginHint (hook side).
 */
export function maybeRecordPluginHint(hint: ClaudeCodeHint): void {
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_lapis_finch', false)) return
// 功能开关闸门，未启用则直接返回。
  if (hasShownHintThisSession()) return

  const state = getGlobalConfig().claudeCodeHints
  if (state?.disabled) return

  const shown = state?.plugin ?? []
  if (shown.length >= MAX_SHOWN_PLUGINS) return

  const pluginId = hint.value
  const { name, marketplace } = parsePluginIdentifier(pluginId)
  if (!name || !marketplace) return
  if (!isOfficialMarketplaceName(marketplace)) return
  if (shown.includes(pluginId)) return
  if (isPluginInstalled(pluginId)) return
  if (isPluginBlockedByPolicy(pluginId)) return

  // Bound repeat lookups on the same slug — a CLI that emits on every
  // invocation shouldn't trigger N resolve cycles for the same plugin.
  if (triedThisSession.has(pluginId)) return
  triedThisSession.add(pluginId)

  setPendingHint(hint)
}
// maybeRecordPluginHint：同步预存闸门，过滤已展示、已安装、非官方等情形。

const triedThisSession = new Set<string>()
// triedThisSession：本会话已尝试的插件集合，避免重复解析。

/** Test-only reset. */
export function _resetHintRecommendationForTesting(): void {
  triedThisSession.clear()
}
// _resetHintRecommendationForTesting：测试重置。

/**
 * Resolve the pending hint to a renderable recommendation. Runs the async
 * marketplace lookup that the sync pre-store gate skipped. Returns null if
 * the plugin isn't in the marketplace cache — the hint is discarded.
 */
export async function resolvePluginHint(
  hint: ClaudeCodeHint,
): Promise<PluginHintRecommendation | null> {
  const pluginId = hint.value
  const { name, marketplace } = parsePluginIdentifier(pluginId)

  const pluginData = await getPluginById(pluginId)

  logEvent('tengu_plugin_hint_detected', {
    _PROTO_plugin_name: (name ??
      '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    _PROTO_marketplace_name: (marketplace ??
      '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    result: (pluginData
      ? 'passed'
      : 'not_in_cache') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  if (!pluginData) {
    logForDebugging(
      `[hintRecommendation] ${pluginId} not found in marketplace cache`,
    )
    return null
  }

  return {
    pluginId,
    pluginName: pluginData.entry.name,
    marketplaceName: marketplace ?? '',
    pluginDescription: pluginData.entry.description,
    sourceCommand: hint.sourceCommand,
  }
}
// resolvePluginHint：异步查市场缓存并拼出可渲染推荐，不在缓存则返回 null。

/**
 * Record that a prompt for this plugin was surfaced. Called regardless of
 * the user's yes/no response — show-once semantics.
 */
export function markHintPluginShown(pluginId: string): void {
  saveGlobalConfig(current => {
    const existing = current.claudeCodeHints?.plugin ?? []
    if (existing.includes(pluginId)) return current
    return {
      ...current,
      claudeCodeHints: {
        ...current.claudeCodeHints,
        plugin: [...existing, pluginId],
      },
    }
  })
}
// markHintPluginShown：记录已展示，实现 show-once 语义。

/** Called when the user picks "don't show plugin installation hints again". */
export function disableHintRecommendations(): void {
  saveGlobalConfig(current => {
    if (current.claudeCodeHints?.disabled) return current
    return {
      ...current,
      claudeCodeHints: { ...current.claudeCodeHints, disabled: true },
    }
  })
}
// disableHintRecommendations：用户选择不再展示提示时置 disabled。
