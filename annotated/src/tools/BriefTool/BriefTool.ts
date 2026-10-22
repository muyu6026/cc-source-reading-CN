import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import { getKairosActive, getUserMsgOptIn } from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_WITH_REFRESH } from '../../services/analytics/growthbook.js'
import { logEvent } from '../../services/analytics/index.js'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { plural } from '../../utils/stringUtils.js'
import { resolveAttachments, validateAttachmentPaths } from './attachments.js'
import {
  BRIEF_TOOL_NAME,
  BRIEF_TOOL_PROMPT,
  DESCRIPTION,
  LEGACY_BRIEF_TOOL_NAME,
} from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    message: z
      .string()
      .describe('The message for the user. Supports markdown formatting.'),
    attachments: z
      .array(z.string())
      .optional()
      .describe(
        'Optional file paths (absolute or relative to cwd) to attach. Use for photos, screenshots, diffs, logs, or any file the user should see alongside your message.',
      ),
    status: z
      .enum(['normal', 'proactive'])
      .describe(
        "Use 'proactive' when you're surfacing something the user hasn't asked for and needs to see now — task completion while they're away, a blocker you hit, an unsolicited status update. Use 'normal' when replying to something the user just said.",
      ),
  }),
)
// 输入 schema：message（markdown 正文）、attachments（可选文件路径）、
// status 标注意图——proactive 是「用户没问但你必须让他看到」（后台任务完成/遇到阻塞），
// normal 是对用户刚说的话的回复。下游路由按这个字段分流。
type InputSchema = ReturnType<typeof inputSchema>

// attachments MUST remain optional — resumed sessions replay pre-attachment
// outputs verbatim and a required field would crash the UI renderer on resume.
// attachments 必须保持可选：恢复（resume）的会话会原样重放旧输出，
// 若设为必填字段，恢复到 attachment 功能上线前的记录会直接崩掉 UI 渲染器。
const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().describe('The message'),
    attachments: z
      .array(
        z.object({
          path: z.string(),
          size: z.number(),
          isImage: z.boolean(),
          file_uuid: z.string().optional(),
        }),
      )
      .optional()
      .describe('Resolved attachment metadata'),
    sentAt: z
      .string()
      .optional()
      .describe(
        'ISO timestamp captured at tool execution on the emitting process. Optional — resumed sessions replay pre-sentAt outputs verbatim.',
      ),
  }),
)
// 输出 schema 同理全部可选：sentAt 是工具执行时在本进程记的 ISO 时间戳，
// 旧记录重放时没有这个字段——可选性是兼容性要求，不是偷懒。
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const KAIROS_BRIEF_REFRESH_MS = 5 * 60 * 1000
// 5 分钟：GB（GrowthBook）特性开关的刷新周期，作为会话中途的 kill-switch 生效间隔。

/**
 * Entitlement check — is the user ALLOWED to use Brief? Combines build-time
 * flags with runtime GB gate + assistant-mode passthrough. No opt-in check
 * here — this decides whether opt-in should be HONORED, not whether the user
 * has opted in.
 *
 * Build-time OR-gated on KAIROS || KAIROS_BRIEF (same pattern as
 * PROACTIVE || KAIROS): assistant mode depends on Brief, so KAIROS alone
 * must bundle it. KAIROS_BRIEF lets Brief ship independently.
 *
 * Use this to decide whether `--brief` / `defaultView: 'chat'` / `--tools`
 * listing should be honored. Use `isBriefEnabled()` to decide whether the
 * tool is actually active in the current session.
 *
 * CLAUDE_CODE_BRIEF env var force-grants entitlement for dev/testing —
 * bypasses the GB gate so you can test without being enrolled. Still
 * requires an opt-in action to activate (--brief, defaultView, etc.), but
 * the env var alone also sets userMsgOptIn via maybeActivateBrief().
 */
export function isBriefEntitled(): boolean {
  // Positive ternary — see docs/feature-gating.md. Negative early-return
  // would not eliminate the GB gate string from external builds.
  return feature('KAIROS') || feature('KAIROS_BRIEF')
    ? getKairosActive() ||
        isEnvTruthy(process.env.CLAUDE_CODE_BRIEF) ||
        getFeatureValue_CACHED_WITH_REFRESH(
          'tengu_kairos_brief',
          false,
          KAIROS_BRIEF_REFRESH_MS,
        )
    : false
}
// isBriefEntitled：用户「有没有资格」用 Brief。构建期特性 OR 门（KAIROS || KAIROS_BRIEF）
// + 运行时 GB 门 + 助手模式直通；不含 opt-in 检查——它决定 opt-in 是否被尊重，
// 而非用户是否已 opt-in。注意正 ternary 写法（见 docs/feature-gating.md）：
// 负向提前 return 会让 GB 门字符串残留在对外构建里。

/**
 * Unified activation gate for the Brief tool. Governs model-facing behavior
 * as a unit: tool availability, system prompt section (getBriefSection),
 * tool-deferral bypass (isDeferredTool), and todo-nag suppression.
 *
 * Activation requires explicit opt-in (userMsgOptIn) set by one of:
 *   - `--brief` CLI flag (maybeActivateBrief in main.tsx)
 *   - `defaultView: 'chat'` in settings (main.tsx init)
 *   - `/brief` slash command (brief.ts)
 *   - `/config` defaultView picker (Config.tsx)
 *   - SendUserMessage in `--tools` / SDK `tools` option (main.tsx)
 *   - CLAUDE_CODE_BRIEF env var (maybeActivateBrief — dev/testing bypass)
 * Assistant mode (kairosActive) bypasses opt-in since its system prompt
 * hard-codes "you MUST use SendUserMessage" (systemPrompt.md:14).
 *
 * The GB gate is re-checked here as a kill-switch AND — flipping
 * tengu_kairos_brief off mid-session disables the tool on the next 5-min
 * refresh even for opted-in sessions. No opt-in → always false regardless
 * of GB (this is the fix for "brief defaults on for enrolled ants").
 *
 * Called from Tool.isEnabled() (lazy, post-init), never at module scope.
 * getKairosActive() and getUserMsgOptIn() are set in main.tsx before any
 * caller reaches here.
 */
export function isBriefEnabled(): boolean {
  // Top-level feature() guard is load-bearing for DCE: Bun can constant-fold
  // the ternary to `false` in external builds and then dead-code the BriefTool
  // object. Composing isBriefEntitled() alone (which has its own guard) is
  // semantically equivalent but defeats constant-folding across the boundary.
  return feature('KAIROS') || feature('KAIROS_BRIEF')
    ? (getKairosActive() || getUserMsgOptIn()) && isBriefEntitled()
    : false
}
// isBriefEnabled：统一的激活总闸，管四件事——工具可用性、系统提示词 Brief 段、
// 工具延迟豁免、todo 催促抑制。激活需显式 opt-in（--brief / defaultView:chat /
// /brief / /config / SendUserMessage / 环境变量），助手模式（kairosActive）豁免 opt-in。
// GB 门在这里二次检查作 kill-switch：会话中途关掉 tengu_kairos_brief，
// 5 分钟刷新后即使已 opt-in 也会失效。「已注册但默认开启」的历史 bug 就是靠这行修复的。

export const BriefTool = buildTool({
  name: BRIEF_TOOL_NAME,
  aliases: [LEGACY_BRIEF_TOOL_NAME],
  searchHint:
    'send a message to the user — your primary visible output channel',
  maxResultSizeChars: 100_000,
  userFacingName() {
    return ''
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isBriefEnabled()
// isEnabled 走 isBriefEnabled（惰性、init 后才调用，绝不模块顶层——
// getKairosActive/getUserMsgOptIn 在 main.tsx 里才赋值）。
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.message
  },
  async validateInput({ attachments }, _context): Promise<ValidationResult> {
    if (!attachments || attachments.length === 0) {
      return { result: true }
    }
    return validateAttachmentPaths(attachments)
  },
// validateInput：有附件才校验（存在性/可读性/是否常规文件），委托 attachments.ts。
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return BRIEF_TOOL_PROMPT
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const n = output.attachments?.length ?? 0
    const suffix = n === 0 ? '' : ` (${n} ${plural(n, 'attachment')} included)`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Message delivered to user.${suffix}`,
    }
  },
// 工具结果文本：Message delivered to user (+N attachments included)——
// 模型据此知道消息已送达及附件数量。
  renderToolUseMessage,
  renderToolResultMessage,
  async call({ message, attachments, status }, context) {
    const sentAt = new Date().toISOString()
    logEvent('tengu_brief_send', {
      proactive: status === 'proactive',
      attachment_count: attachments?.length ?? 0,
    })
// tengu_brief_send 埋点：是否 proactive、附件数。
    if (!attachments || attachments.length === 0) {
      return { data: { message, sentAt } }
    }
    const appState = context.getAppState()
    const resolved = await resolveAttachments(attachments, {
      replBridgeEnabled: appState.replBridgeEnabled,
      signal: context.abortController.signal,
    })
    return {
      data: { message, attachments: resolved, sentAt },
    }
// call：记 sentAt → 打点 → 无附件直接返回 → 有附件经 resolveAttachments
// 解析（桥接开启时含上传换 file_uuid）。
  },
} satisfies ToolDef<InputSchema, Output>)
