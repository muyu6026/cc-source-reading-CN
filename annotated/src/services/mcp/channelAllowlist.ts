/**
 * Approved channel plugins allowlist. --channels plugin:name@marketplace
 * entries only register if {marketplace, plugin} is on this list. server:
 * entries always fail (schema is plugin-only). The
 * --dangerously-load-development-channels flag bypasses for both kinds.
 * Lives in GrowthBook so it can be updated without a release.
 *
 * Plugin-level granularity: if a plugin is approved, all its channel
 * servers are. Per-server gating was overengineering — a plugin that
 * sprouts a malicious second server is already compromised, and per-server
 * entries would break on harmless plugin refactors.
 *
 * The allowlist check is a pure {marketplace, plugin} comparison against
 * the user's typed tag. The gate's separate 'marketplace' step verifies
 * the tag matches what's actually installed before this check runs.
 */
// 注释解释了「为什么按 plugin 而不是按 server 授权」，补一句它的代价：
//
// 批准一个 plugin，实际批准的是「这个作者**今后所有版本**」。新版本里多挂一个
// server，那台 server 自动获得「能往对话里推消息」的能力，不需要任何人再点一次。
// 官方把 per-server 说成 overengineering，前提是「被批过的插件已经被审过」——
// 所以这份名单的可信度，就是整个通道功能的可信度上限。

import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

export type ChannelAllowlistEntry = {
  marketplace: string
  plugin: string
}

const ChannelAllowlistSchema = lazySchema(() =>
  z.array(
    z.object({
      marketplace: z.string(),
      plugin: z.string(),
    }),
  ),
)

export function getChannelAllowlist(): ChannelAllowlistEntry[] {
// safeParse 失败就当空表。这里值得注意方向：GrowthBook 上的值是人手改的 JSON，
// 形状写错不能让 --channels 崩，而「空表」的效果是**全部不通过**。
// 出错时收紧而不是放开，是这类远端配置读取的通用原则。
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_harbor_ledger',
    [],
  )
  const parsed = ChannelAllowlistSchema().safeParse(raw)
  return parsed.success ? parsed.data : []
}

/**
 * Overall channels on/off. Checked before any per-server gating —
 * when false, --channels is a no-op and no handlers register.
 * Default false; GrowthBook 5-min refresh.
 */
export function isChannelsEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor', false)
}

/**
 * Pure allowlist check keyed off the connection's pluginSource — for UI
 * pre-filtering so the IDE only shows "Enable channel?" for servers that will
 * actually pass the gate. Not a security boundary: channel_enable still runs
 * the full gate. Matches the allowlist comparison inside gateChannelServer()
 * but standalone (no session/marketplace coupling — those are tautologies
 * when the entry is derived from pluginSource).
 *
 * Returns false for undefined pluginSource (non-plugin server — can never
 * match the {marketplace, plugin}-keyed ledger) and for @-less sources
 * (builtin/inline — same reason).
 */
export function isChannelAllowlisted(
  pluginSource: string | undefined,
): boolean {
// 函数名很像安全判断，但注释明说「Not a security boundary」：
// 它只用于 UI 预筛（要不要显示「启用通道？」），真闸在 gateChannelServer()。
//
// 于是同一套 {marketplace, plugin} 比较在仓库里有两份。改一处的症状是
// 「UI 说可以、点下去被拒」——不会漏防，但会让人不信任 UI。
  if (!pluginSource) return false
  const { name, marketplace } = parsePluginIdentifier(pluginSource)
  if (!marketplace) return false
  return getChannelAllowlist().some(
    e => e.plugin === name && e.marketplace === marketplace,
  )
}
