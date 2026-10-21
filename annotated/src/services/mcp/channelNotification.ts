/**
 * Channel notifications — lets an MCP server push user messages into the
 * conversation. A "channel" (Discord, Slack, SMS, etc.) is just an MCP server
 * that:
 *   - exposes tools for outbound messages (e.g. `send_message`) — standard MCP
 *   - sends `notifications/claude/channel` notifications for inbound — this file
 *
 * The notification handler wraps the content in a <channel> tag and
 * enqueues it. SleepTool polls hasCommandsInQueue() and wakes within 1s.
 * The model sees where the message came from and decides which tool to reply
 * with (the channel's MCP tool, SendUserMessage, or both).
 *
 * feature('KAIROS') || feature('KAIROS_CHANNELS'). Runtime gate tengu_harbor.
 * Requires claude.ai OAuth auth — API key users are blocked until
 * console gets a channelsEnabled admin surface. Teams/Enterprise orgs
 * must explicitly opt in via channelsEnabled: true in managed settings.
 */

// 「通道」不是一个新概念，它就是 MCP server 的一个子集，两个方向各用一套老机制：
//   · 出站（CC → 人）：普通工具调用，比如 send_message
//   · 入站（人 → CC）：notification，也就是本文件
//
// 所以要理解通道，必须同时读工具侧和这里 —— 单看任何一半都会觉得「怎么只做了一半」。
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import { type ChannelEntry, getAllowedChannels } from '../../bootstrap/state.js'
import { CHANNEL_TAG } from '../../constants/xml.js'
import {
  getClaudeAIOAuthTokens,
  getSubscriptionType,
} from '../../utils/auth.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'
import { escapeXmlAttr } from '../../utils/xml.js'
import {
  type ChannelAllowlistEntry,
  getChannelAllowlist,
  isChannelsEnabled,
} from './channelAllowlist.js'

export const ChannelMessageNotificationSchema = lazySchema(() =>
  z.object({
    method: z.literal('notifications/claude/channel'),
    params: z.object({
      content: z.string(),
      // Opaque passthrough — thread_id, user, whatever the channel wants the
      // model to see. Rendered as attributes on the <channel> tag.
      meta: z.record(z.string(), z.string()).optional(),
    }),
  }),
)

/**
 * Structured permission reply from a channel server. Servers that support
 * this declare `capabilities.experimental['claude/channel/permission']` and
 * emit this event INSTEAD of relaying "yes tbxkq" as text via
 * notifications/claude/channel. Explicit opt-in per server — a channel that
 * just wants to relay text never becomes a permission surface by accident.
 *
 * The server parses the user's reply (spec: /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i)
 * and emits {request_id, behavior}. CC matches request_id against its
 * pending map. Unlike the regex-intercept approach, text in the general
 * channel can never accidentally match — approval requires the server
 * to deliberately emit this specific event.
 */
export const CHANNEL_PERMISSION_METHOD =
  'notifications/claude/channel/permission'
export const ChannelPermissionNotificationSchema = lazySchema(() =>
  z.object({
    method: z.literal(CHANNEL_PERMISSION_METHOD),
    params: z.object({
      request_id: z.string(),
      behavior: z.enum(['allow', 'deny']),
    }),
  }),
)

/**
 * Outbound: CC → server. Fired from interactiveHandler.ts when a
 * permission dialog opens and the server has declared the permission
 * capability. Server formats the message for its platform (Telegram
 * markdown, iMessage rich text, Discord embed) and sends it to the
 * human. When the human replies "yes tbxkq", the server parses that
 * against PERMISSION_REPLY_RE and emits the inbound schema above.
 *
 * Not a zod schema — CC SENDS this, doesn't validate it. A type here
 * keeps both halves of the protocol documented side by side.
 */
export const CHANNEL_PERMISSION_REQUEST_METHOD =
  'notifications/claude/channel/permission_request'
export type ChannelPermissionRequestParams = {
  request_id: string
  tool_name: string
  description: string
  /** JSON-stringified tool input, truncated to 200 chars with …. Full
   *  input is in the local terminal dialog; this is a phone-sized
   *  preview. Server decides whether/how to show it. */
  input_preview: string
}

/**
 * Meta keys become XML attribute NAMES — a crafted key like
 * `x="" injected="y` would break out of the attribute structure. Only
 * accept keys that look like plain identifiers. This is stricter than
 * the XML spec (which allows `:`, `.`, `-`) but channel servers only
 * send `chat_id`, `user`, `thread_ts`, `message_id` in practice.
 */
const SAFE_META_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/
// meta 的**值**会变成 XML 属性值，**键**会变成属性名。两侧处理不对称：
//
// 属性值有 escapeXmlAttr 保护（把引号、尖括号都换掉）；属性名没法这样保护 ——
// 转义完就不是一个合法名字了。于是只能拒绝：一个只允许标识符字符的白名单。
//
// 这是注入面处理的常见分工：能转义的就转义，不能转义的就白名单。
// 注释里那个 `x="" injected="y` 就是「键当属性名」被利用的样子。

export function wrapChannelMessage(
  serverName: string,
  content: string,
  meta?: Record<string, string>,
): string {
  const attrs = Object.entries(meta ?? {})
    .filter(([k]) => SAFE_META_KEY.test(k))
    .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
    .join('')
  return `<${CHANNEL_TAG} source="${escapeXmlAttr(serverName)}"${attrs}>\n${content}\n</${CHANNEL_TAG}>`
}

/**
 * Effective allowlist for the current session. Team/enterprise orgs can set
 * allowedChannelPlugins in managed settings — when set, it REPLACES the
 * GrowthBook ledger (admin owns the trust decision). Undefined falls back
 * to the ledger. Unmanaged users always get the ledger.
 *
 * Callers already read sub/policy for the policy gate — pass them in to
 * avoid double-reading getSettingsForSource (uncached).
 */
export function getEffectiveChannelAllowlist(
  sub: ReturnType<typeof getSubscriptionType>,
  orgList: ChannelAllowlistEntry[] | undefined,
): {
  entries: ChannelAllowlistEntry[]
  source: 'org' | 'ledger'
} {
// 组织策略**替换**而不是叠加 ledger：托管组织自己承担信任决定，官方名单在这里不生效。
//
// 但条件是 `(team|enterprise) && orgList` —— 只有组织**真的配了**才替换；
// 没配就落回 ledger。注意 orgList 为 undefined 与空数组的区别：
// 空数组意味着「组织明确说一个都不批」，这是有效值，会真的把通道关死。
  if ((sub === 'team' || sub === 'enterprise') && orgList) {
    return { entries: orgList, source: 'org' }
  }
  return { entries: getChannelAllowlist(), source: 'ledger' }
}

export type ChannelGateResult =
  | { action: 'register' }
  | {
      action: 'skip'
      kind:
        | 'capability'
        | 'disabled'
        | 'auth'
        | 'policy'
        | 'session'
        | 'marketplace'
        | 'allowlist'
      reason: string
    }

/**
 * Match a connected MCP server against the user's parsed --channels entries.
 * server-kind is exact match on bare name; plugin-kind matches on the second
 * segment of plugin:X:Y. Returns the matching entry so callers can read its
 * kind — that's the user's trust declaration, not inferred from runtime shape.
 */
export function findChannelEntry(
  serverName: string,
  channels: readonly ChannelEntry[],
): ChannelEntry | undefined {
  // split unconditionally — for a bare name like 'slack', parts is ['slack']
  // and the plugin-kind branch correctly never matches (parts[0] !== 'plugin').
  const parts = serverName.split(':')
  return channels.find(c =>
    c.kind === 'server'
      ? serverName === c.name
      : parts[0] === 'plugin' && parts[1] === c.name,
  )
}

/**
 * Gate an MCP server's channel-notification path. Caller checks
 * feature('KAIROS') || feature('KAIROS_CHANNELS') first (build-time
 * elimination). Gate order: capability → runtime gate (tengu_harbor) →
 * auth (OAuth only) → org policy → session --channels → allowlist.
 * API key users are blocked at the auth layer — channels requires
 * claude.ai auth; console orgs have no admin opt-in surface yet.
 *
 *   skip      Not a channel server, or managed org hasn't opted in, or
 *             not in session --channels. Connection stays up; handler
 *             not registered.
 *   register  Subscribe to notifications/claude/channel.
 *
 * Which servers can connect at all is governed by allowedMcpServers —
 * this gate only decides whether the notification handler registers.
 */
// 闸的顺序本身就是设计文档，每一段位置都有理由：
//
//   capability → 先排除普通 MCP server，省得后面每条都为它查一遍远端配置
//   全局开关   → killswitch 要能在任何会话状态下生效，所以在 auth/policy **之前**
//   认证       → 通道需要 claude.ai 身份，API key 用户在这层就被挡住
//   组织策略   → team/enterprise 必须显式开启（缺省不开）
//   会话名单   → --channels 里没写就不注册
//   市场/名单  → 最后才查「这个插件被批准了吗」
//
// 顺序错了不只是性能问题：killswitch 若排在认证后面，一个 OAuth 失效的用户
// 会看到「需要登录」，而不是「功能没开」—— 用户会去修一个没坏的东西。
export function gateChannelServer(
  serverName: string,
  capabilities: ServerCapabilities | undefined,
  pluginSource: string | undefined,
): ChannelGateResult {
  // Channel servers declare `experimental['claude/channel']: {}` (MCP's
  // presence-signal idiom — same as `tools: {}`). Truthy covers `{}` and
  // `true`; absent/undefined/explicit-`false` all fail. Key matches the
  // notification method namespace (notifications/claude/channel).
  if (!capabilities?.experimental?.['claude/channel']) {
    return {
      action: 'skip',
      kind: 'capability',
      reason: 'server did not declare claude/channel capability',
    }
  }

  // Overall runtime gate. After capability so normal MCP servers never hit
  // this path. Before auth/policy so the killswitch works regardless of
  // session state.
  if (!isChannelsEnabled()) {
    return {
      action: 'skip',
      kind: 'disabled',
      reason: 'channels feature is not currently available',
    }
  }

  // OAuth-only. API key users (console) are blocked — there's no
  // channelsEnabled admin surface in console yet, so the policy opt-in
  // flow doesn't exist for them. Drop this when console parity lands.
  if (!getClaudeAIOAuthTokens()?.accessToken) {
    return {
      action: 'skip',
      kind: 'auth',
      reason: 'channels requires claude.ai authentication (run /login)',
    }
  }

  // Teams/Enterprise opt-in. Managed orgs must explicitly enable channels.
  // Default OFF — absent or false blocks. Keyed off subscription tier, not
  // "policy settings exist" — a team org with zero configured policy keys
  // (remote endpoint returns 404) is still a managed org and must not fall
  // through to the unmanaged path.
  const sub = getSubscriptionType()
  const managed = sub === 'team' || sub === 'enterprise'
  const policy = managed ? getSettingsForSource('policySettings') : undefined
  if (managed && policy?.channelsEnabled !== true) {
    return {
      action: 'skip',
      kind: 'policy',
      reason:
        'channels not enabled by org policy (set channelsEnabled: true in managed settings)',
    }
  }

  // User-level session opt-in. A server must be explicitly listed in
  // --channels to push inbound this session — protects against a trusted
  // server surprise-adding the capability.
  const entry = findChannelEntry(serverName, getAllowedChannels())
  if (!entry) {
    return {
      action: 'skip',
      kind: 'session',
      reason: `server ${serverName} not in --channels list for this session`,
    }
  }

  if (entry.kind === 'plugin') {
// 这里区分「用户打的标签」和「实际装的是什么」：
//
//   plugin:slack@anthropic  ← 意图（用户敲的）
//   plugin:slack:X          ← 运行时名字，X 可能是 anthropic，也可能是 evil
//
// 所以要用 pluginSource（配置构建时塞进去的真实来源）反查真实市场再比。
// 这是整个闸里唯一一处「不信用户输入」的地方，也是它最像安全检查的地方 ——
// 上面那些判断都只是策略，这一处才是防冒充。
    // Marketplace verification: the tag is intent (plugin:slack@anthropic),
    // the runtime name is just plugin:slack:X — could be slack@anthropic or
    // slack@evil depending on what's installed. Verify they match before
    // trusting the tag for the allowlist check below. Source is stashed on
    // the config at addPluginScopeToServers — undefined (non-plugin server,
    // shouldn't happen for plugin-kind entry) or @-less (builtin/inline)
    // both fail the comparison.
    const actual = pluginSource
      ? parsePluginIdentifier(pluginSource).marketplace
      : undefined
    if (actual !== entry.marketplace) {
      return {
        action: 'skip',
        kind: 'marketplace',
        reason: `you asked for plugin:${entry.name}@${entry.marketplace} but the installed ${entry.name} plugin is from ${actual ?? 'an unknown source'}`,
      }
    }

    // Approved-plugin allowlist. Marketplace gate already verified
    // tag == reality, so this is a pure entry check. entry.dev (per-entry,
    // not the session-wide bit) bypasses — so accepting the dev dialog for
    // one entry doesn't leak allowlist-bypass to --channels entries.
    if (!entry.dev) {
      const { entries, source } = getEffectiveChannelAllowlist(
        sub,
        policy?.allowedChannelPlugins,
      )
      if (
        !entries.some(
          e => e.plugin === entry.name && e.marketplace === entry.marketplace,
        )
      ) {
        return {
          action: 'skip',
          kind: 'allowlist',
          reason:
            source === 'org'
              ? `plugin ${entry.name}@${entry.marketplace} is not on your org's approved channels list (set allowedChannelPlugins in managed settings)`
              : `plugin ${entry.name}@${entry.marketplace} is not on the approved channels allowlist (use --dangerously-load-development-channels for local dev)`,
        }
      }
    }
  } else {
// 这个 else 分支值得单独看，因为它是「形状不匹配」而不是「值不匹配」：
//
// 名单条目的 schema 是 {marketplace, plugin}，没有 server 这一维。所以
// `--channels server:xxx` 永远过不了名单检查，除非带开发标志。
//
// 注释说的漏洞很具体：不加这段，`--channels server:plugin:foo:bar` 会匹配上
// 某个插件的运行时名（findChannelEntry 里 parts[1] 比的就是它），
// 从而在完全没过名单的情况下注册成功。
    // server-kind: allowlist schema is {marketplace, plugin} — a server entry
    // can never match. Without this, --channels server:plugin:foo:bar would
    // match a plugin's runtime name and register with no allowlist check.
    if (!entry.dev) {
      return {
        action: 'skip',
        kind: 'allowlist',
        reason: `server ${entry.name} is not on the approved channels allowlist (use --dangerously-load-development-channels for local dev)`,
      }
    }
  }

  return { action: 'register' }
}
