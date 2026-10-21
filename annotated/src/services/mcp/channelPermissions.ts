/**
 * Permission prompts over channels (Telegram, iMessage, Discord).
 *
 * Mirrors `BridgePermissionCallbacks` — when CC hits a permission dialog,
 * it ALSO sends the prompt via active channels and races the reply against
 * local UI / bridge / hooks / classifier. First resolver wins via claim().
 *
 * Inbound is a structured event: the server parses the user's "yes tbxkq"
 * reply and emits notifications/claude/channel/permission with
 * {request_id, behavior}. CC never sees the reply as text — approval
 * requires the server to deliberately emit that specific event, not just
 * relay content. Servers opt in by declaring
 * capabilities.experimental['claude/channel/permission'].
 *
 * Kenneth's "would this let Claude self-approve?": the approving party is
 * the human via the channel, not Claude. But the trust boundary isn't the
 * terminal — it's the allowlist (tengu_harbor_ledger). A compromised
 * channel server CAN fabricate "yes <id>" without the human seeing the
 * prompt. Accepted risk: a compromised channel already has unlimited
 * conversation-injection turns (social-engineer over time, wait for
 * acceptEdits, etc.); inject-then-self-approve is faster, not more
 * capable. The dialog slows a compromised channel; it doesn't stop one.
 * See PR discussion 2956440848.
 */
// 文件头那段 Kenneth 之问（"这会不会让 Claude 自己批准自己？"）是整份文件的核心。
//
// 答案不是「不会」，而是「能不能自己批取决于通道服务器」：审批人确实是人，
// 但**信任边界不是终端，而是 allowlist**（tengu_harbor_ledger）。
//
// 于是整套机制的强度 = 名单的可信度，而不是通道的可信度。一个被攻陷的通道
// 可以伪造「yes <id>」而人根本没看见提示 —— 作者接受了这个风险，理由是
// 「被攻陷的通道本来就能无限次往对话里注入内容，自批只是更快，不是更强」。
// 这个论证值得抄下来：它衡量的是「增量风险」，不是「绝对风险」。

import { jsonStringify } from '../../utils/slowOperations.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

/**
 * GrowthBook runtime gate — separate from the channels gate (tengu_harbor)
 * so channels can ship without permission-relay riding along (Kenneth: "no
 * bake time if it goes out tomorrow"). Default false; flip without a release.
 * Checked once at useManageMCPConnections mount — mid-session flag changes
 * don't apply until restart.
 */
export function isChannelPermissionRelayEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_permissions', false)
}

export type ChannelPermissionResponse = {
  behavior: 'allow' | 'deny'
  /** Which channel server the reply came from (e.g., "plugin:telegram:tg"). */
  fromServer: string
}

export type ChannelPermissionCallbacks = {
  /** Register a resolver for a request ID. Returns unsubscribe. */
  onResponse(
    requestId: string,
    handler: (response: ChannelPermissionResponse) => void,
  ): () => void
  /** Resolve a pending request from a structured channel event
   *  (notifications/claude/channel/permission). Returns true if the ID
   *  was pending — the server parsed the user's reply and emitted
   *  {request_id, behavior}; we just match against the map. */
  resolve(
    requestId: string,
    behavior: 'allow' | 'deny',
    fromServer: string,
  ): boolean
}

/**
 * Reply format spec for channel servers to implement:
 *   /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i
 *
 * 5 lowercase letters, no 'l' (looks like 1/I). Case-insensitive (phone
 * autocorrect). No bare yes/no (conversational). No prefix/suffix chatter.
 *
 * CC generates the ID and sends the prompt. The SERVER parses the user's
 * reply and emits notifications/claude/channel/permission with {request_id,
 * behavior} — CC doesn't regex-match text anymore. Exported so plugins can
 * import the exact regex rather than hand-copying it.
 */
export const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i
// 这个正则本身是**协议的一部分**，所以被导出给插件用（让服务端别手抄错）。
// 每一条约束都对应一个真实误判场景：
//
//   · 字母表去掉 l —— 很多字体里和 1 / I 无法区分
//   · 固定 5 位、必须带 ID —— 防止把日常对话里的 "yes" 当成批准
//   · 大小写不敏感 —— 手机输入法会自动大写首字母
//   · 前后不许有多余文字 —— 防止 "yes but wait" 被理解成批准
//
// 换句话说：这不是「好用的格式」，是「不容易被误触发的格式」。

// 25-letter alphabet: a-z minus 'l' (looks like 1/I). 25^5 ≈ 9.8M space.
const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz'

// Substring blocklist — 5 random letters can spell things (Kenneth, in the
// launch thread: "this is why i bias to numbers, hard to have anything worse
// than 80085"). Non-exhaustive, covers the send-to-your-boss-by-accident
// tier. If a generated ID contains any of these, re-hash with a salt.
// prettier-ignore
const ID_AVOID_SUBSTRINGS = [
  'fuck',
  'shit',
  'cunt',
  'cock',
  'dick',
  'twat',
  'piss',
  'crap',
  'bitch',
  'whore',
  'ass',
  'tit',
  'cum',
  'fag',
  'dyke',
  'nig',
  'kike',
  'rape',
  'nazi',
  'damn',
  'poo',
  'pee',
  'wank',
  'anus',
]
// 24 个词的屏蔽表，注释自认「非穷尽」。它存在的意义是承认一件事：
// 5 个随机字母**不够随机** —— 25^5 约 980 万种组合，能拼出的英文词足够多，
// 而这条消息是要发到用户手机上的。
//
// 表里的词不是按严重程度排的，是按「会不会出现在发给老板的短信里」挑的。
// 这类表永远补不全，所以真正的保险是下面的加盐重算，而不是这张表本身。

function hashToId(input: string): string {
  // FNV-1a → uint32, then base-25 encode. Not crypto, just a stable
  // short letters-only ID. 32 bits / log2(25) ≈ 6.9 letters of entropy;
  // taking 5 wastes a little, plenty for this.
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h = h >>> 0
  let s = ''
  for (let i = 0; i < 5; i++) {
    s += ID_ALPHABET[h % 25]
    h = Math.floor(h / 25)
  }
  return s
}

/**
 * Short ID from a toolUseID. 5 letters from a 25-char alphabet (a-z minus
 * 'l' — looks like 1/I in many fonts). 25^5 ≈ 9.8M space, birthday
 * collision at 50% needs ~3K simultaneous pending prompts, absurd for a
 * single interactive session. Letters-only so phone users don't switch
 * keyboard modes (hex alternates a-f/0-9 → mode toggles). Re-hashes with
 * a salt suffix if the result contains a blocklisted substring — 5 random
 * letters can spell things you don't want in a text message to your phone.
 * toolUseIDs are `toolu_` + base64-ish; we hash rather than slice.
 */
export function shortRequestId(toolUseID: string): string {
  // 7 length-3 × 3 positions × 25² + 15 length-4 × 2 × 25 + 2 length-5
  // ≈ 13,877 blocked IDs out of 9.8M — roughly 1 in 700 hits the blocklist.
  // Cap at 10 retries; (1/700)^10 is negligible.
  let candidate = hashToId(toolUseID)
// 命中屏蔽词就加盐重算，最多 10 次。注释给了概率：约 1/700 命中，
// 10 次全中约 (1/700)^10，可以忽略。
//
// 注意最后那个 return 会把「10 次全是屏蔽词」的候选原样返回 —— 也就是
// 极小概率下仍会发出一个脏 ID。这是「宁可极小概率丢脸，也不要在这里抛异常/
// 死循环」的取舍。循环里没有 throw，也没有 while(true)。
  for (let salt = 0; salt < 10; salt++) {
    if (!ID_AVOID_SUBSTRINGS.some(bad => candidate.includes(bad))) {
      return candidate
    }
    candidate = hashToId(`${toolUseID}:${salt}`)
  }
  return candidate
}

/**
 * Truncate tool input to a phone-sized JSON preview. 200 chars is
 * roughly 3 lines on a narrow phone screen. Full input is in the local
 * terminal dialog; the channel gets a summary so Write(5KB-file) doesn't
 * flood your texts. Server decides whether/how to show it.
 */
export function truncateForPreview(input: unknown): string {
  try {
    const s = jsonStringify(input)
    return s.length > 200 ? s.slice(0, 200) + '…' : s
  } catch {
    return '(unserializable)'
  }
}

/**
 * Filter MCP clients down to those that can relay permission prompts.
 * Three conditions, ALL required: connected + in the session's --channels
 * allowlist + declares BOTH capabilities. The second capability is the
 * server's explicit opt-in — a relay-only channel never becomes a
 * permission surface by accident (Kenneth's "users may be unpleasantly
 * surprised"). Centralized here so a future fourth condition lands once.
 */
export function filterPermissionRelayClients<
  T extends {
    type: string
    name: string
    capabilities?: { experimental?: Record<string, unknown> }
  },
>(
  clients: readonly T[],
  isInAllowlist: (name: string) => boolean,
): (T & { type: 'connected' })[] {
// 三个条件全都要：连着 + 在本次 --channels 名单里 + 声明了**两个** capability。
//
// 第二个（claude/channel/permission）是服务端的显式选择加入，这是关键：
// 一个只做消息转发的通道，不会因为「它能转发」就顺手获得「它能批准」的能力。
// 注释引的那句「users may be unpleasantly surprised」说的正是这个 ——
// 权限面的扩大必须由被授权方主动声明，不能由能力推断。
  return clients.filter(
    (c): c is T & { type: 'connected' } =>
      c.type === 'connected' &&
      isInAllowlist(c.name) &&
      c.capabilities?.experimental?.['claude/channel'] !== undefined &&
      c.capabilities?.experimental?.['claude/channel/permission'] !== undefined,
  )
}

/**
 * Factory for the callbacks object. The pending Map is closed over — NOT
 * module-level (per src/CLAUDE.md), NOT in AppState (functions-in-state
 * causes issues with equality/serialization). Same lifetime pattern as
 * `replBridgePermissionCallbacks`: constructed once per session inside
 * a React hook, stable reference stored in AppState.
 *
 * resolve() is called from the dedicated notification handler
 * (notifications/claude/channel/permission) with the structured payload.
 * The server already parsed "yes tbxkq" → {request_id, behavior}; we just
 * match against the pending map. No regex on CC's side — text in the
 * general channel can't accidentally approve anything.
 */
export function createChannelPermissionCallbacks(): ChannelPermissionCallbacks {
  const pending = new Map<
    string,
    (response: ChannelPermissionResponse) => void
  >()

  return {
    onResponse(requestId, handler) {
// 两端都 toLowerCase。注释说今天 shortRequestId 只产小写所以是 noop，
// 但坚持把契约写成对称的。
//
// 这类「为了将来不出事而多写一行」的地方，通常是因为已经出过一次事：
// 一边小写一边不小写，症状是「审批点了没反应」，而且查不出来 ——
// 因为两边各自的逻辑都没错。
      // Lowercase here too — resolve() already does; asymmetry means a
      // future caller passing a mixed-case ID would silently never match.
      // shortRequestId always emits lowercase so this is a noop today,
      // but the symmetry makes the contract explicit.
      const key = requestId.toLowerCase()
      pending.set(key, handler)
      return () => {
        pending.delete(key)
      }
    },

    resolve(requestId, behavior, fromServer) {
      const key = requestId.toLowerCase()
      const resolver = pending.get(key)
      if (!resolver) return false
      // Delete BEFORE calling — if resolver throws or re-enters, the
      // entry is already gone. Also handles duplicate events (second
      // emission falls through — server bug or network dup, ignore).
// delete 在调用之前，注释给了两个理由（resolver 抛异常/重入、重复投递）。
// 补第三个，也是最实际的：先 resolve 再 delete 的话，resolve 同步触发的后续
// （比如立刻发起下一次审批、又往表里写同一个 key）会被这一次的 delete 抹掉。
//
// 「先删表项再回调」是回调注册表的标准顺序，和事件监听器的 once 语义同源。
      pending.delete(key)
      resolver({ behavior, fromServer })
      return true
    },
  }
}
