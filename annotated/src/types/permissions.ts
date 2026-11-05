// 整份文件只放权限系统的「纯类型」与常量，刻意不带任何运行时依赖——目的是切断 utils/permissions 与命令层之间的导入环，让类型能安全地向两边暴露
/**
 * Pure permission type definitions extracted to break import cycles.
 *
 * This file contains only type definitions and constants with no runtime dependencies.
 * Implementation files remain in src/utils/permissions/ but can now import from here
 * to avoid circular dependencies.
 */

import { feature } from 'bun:bundle'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

// ============================================================================
// Permission Modes
// ============================================================================

// 对外暴露的权限模式全集：这些是会写进设置文件、出现在命令行参数与恢复快照里的「用户可寻址」模式
export const EXTERNAL_PERMISSION_MODES = [
  'acceptEdits',
  'bypassPermissions',
  'default',
  'dontAsk',
  'plan',
] as const

export type ExternalPermissionMode = (typeof EXTERNAL_PERMISSION_MODES)[number]

// Exhaustive mode union for typechecking. The user-addressable runtime set
// is INTERNAL_PERMISSION_MODES below.
// 内部模式在外部集合之上追加 auto 与 bubble：auto 是自动模式开关、bubble 是气泡确认模式，它们不直接出现在用户设置界面，只在内部流转
export type InternalPermissionMode = ExternalPermissionMode | 'auto' | 'bubble'
export type PermissionMode = InternalPermissionMode

// Runtime validation set: modes that are user-addressable (settings.json
// defaultMode, --permission-mode CLI flag, conversation recovery).
// 运行期真正校验的集合：用构建期 feature 开关把 auto 包起来，未开启 TRANSCRIPT_CLASSIFIER 时 auto 根本不存在，避免把无效模式当成合法值
export const INTERNAL_PERMISSION_MODES = [
  ...EXTERNAL_PERMISSION_MODES,
  ...(feature('TRANSCRIPT_CLASSIFIER') ? (['auto'] as const) : ([] as const)),
] as const satisfies readonly PermissionMode[]

export const PERMISSION_MODES = INTERNAL_PERMISSION_MODES

// ============================================================================
// Permission Behaviors
// ============================================================================

// 每条规则三种行为：allow 放行、deny 拒绝、ask 弹窗询问
export type PermissionBehavior = 'allow' | 'deny' | 'ask'

// ============================================================================
// Permission Rules
// ============================================================================

/**
 * Where a permission rule originated from.
 * Includes all SettingSource values plus additional rule-specific sources.
 */
// 规则来源枚举：区分用户设置、项目设置、本地设置、命令行、策略层、会话内等，来源决定了优先级与可被覆盖的范围
export type PermissionRuleSource =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'
  | 'cliArg'
  | 'command'
  | 'session'

/**
 * The value of a permission rule - specifies which tool and optional content
 */
// 规则的值就是一个工具名加可选的匹配内容（比如某条拒绝规则针对的具体命令模式）
export type PermissionRuleValue = {
  toolName: string
  ruleContent?: string
}

/**
 * A permission rule with its source and behavior
 */
// 一条完整规则 = 来源 + 行为 + 值
export type PermissionRule = {
  source: PermissionRuleSource
  ruleBehavior: PermissionBehavior
  ruleValue: PermissionRuleValue
}

// ============================================================================
// Permission Updates
// ============================================================================

/**
 * Where a permission update should be persisted
 */
// 更新落点：规则该写到哪一层配置（用户 / 项目 / 本地 / 会话 / 命令行）
export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg'

/**
 * Update operations for permission configuration
 */
// 更新操作是一个判别联合：加规则、替换规则、删规则、设模式、加目录、删目录——每种都带落点信息
export type PermissionUpdate =
  | {
      type: 'addRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
    }
  | {
      type: 'replaceRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
    }
  | {
      type: 'removeRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
    }
  | {
      type: 'setMode'
      destination: PermissionUpdateDestination
      mode: ExternalPermissionMode
    }
  | {
      type: 'addDirectories'
      destination: PermissionUpdateDestination
      directories: string[]
    }
  | {
      type: 'removeDirectories'
      destination: PermissionUpdateDestination
      directories: string[]
    }

/**
 * Source of an additional working directory permission.
 * Note: This is currently the same as PermissionRuleSource but kept as a
 * separate type for semantic clarity and potential future divergence.
 */
// 额外工作目录的来源类型直接复用规则来源类型，仅为语义清晰而独立出来（未来可能分化出自己的取值）
export type WorkingDirectorySource = PermissionRuleSource

/**
 * An additional directory included in permission scope
 */
// 额外纳入权限作用域的目录 = 路径 + 来源
export type AdditionalWorkingDirectory = {
  path: string
  source: WorkingDirectorySource
}

// ============================================================================
// Permission Decisions & Results
// ============================================================================

/**
 * Minimal command shape for permission metadata.
 * This is intentionally a subset of the full Command type to avoid import cycles.
 * Only includes properties needed by permission-related components.
 */
// 权限判定需要的命令最小形状：只取名字与描述，刻意做成完整 Command 类型的子集以断环
export type PermissionCommandMetadata = {
  name: string
  description?: string
  // Allow additional properties for forward compatibility
  [key: string]: unknown
}

/**
 * Metadata attached to permission decisions
 */
// 判定附带的元数据：要么是命令信息，要么没有
export type PermissionMetadata =
  | { command: PermissionCommandMetadata }
  | undefined

/**
 * Result when permission is granted
 */
// 放行判定的形状：放行时可顺手改输入、记录用户改过、附带理由与内容块（如图片）
export type PermissionAllowDecision<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> = {
  behavior: 'allow'
  updatedInput?: Input
  userModified?: boolean
  decisionReason?: PermissionDecisionReason
  toolUseID?: string
  acceptFeedback?: string
  contentBlocks?: ContentBlockParam[]
}

/**
 * Metadata for a pending classifier check that will run asynchronously.
 * Used to enable non-blocking allow classifier evaluation.
 */
export type PendingClassifierCheck = {
  command: string
  cwd: string
  descriptions: string[]
}

/**
 * Result when user should be prompted
 */
// 询问判定最复杂：携带消息、建议、被拦路径，以及可选的异步分类器检查——在用户回应前就尝试用安全模型自动放行
export type PermissionAskDecision<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> = {
  behavior: 'ask'
  message: string
  updatedInput?: Input
  decisionReason?: PermissionDecisionReason
  suggestions?: PermissionUpdate[]
  blockedPath?: string
  metadata?: PermissionMetadata
  /**
   * If true, this ask decision was triggered by a bashCommandIsSafe_DEPRECATED security check
   * for patterns that splitCommand_DEPRECATED could misparse (e.g. line continuations, shell-quote
   * transformations). Used by bashToolHasPermission to block early before splitCommand_DEPRECATED
   * transforms the command. Not set for simple newline compound commands.
   */
  isBashSecurityCheckForMisparsing?: boolean
  /**
   * If set, an allow classifier check should be run asynchronously.
   * The classifier may auto-approve the permission before the user responds.
   */
  pendingClassifierCheck?: PendingClassifierCheck
  /**
   * Optional content blocks (e.g., images) to include alongside the rejection
   * message in the tool result. Used when users paste images as feedback.
   */
  contentBlocks?: ContentBlockParam[]
}

/**
 * Result when permission is denied
 */
// 拒绝判定：消息 + 理由，理由类型决定了界面怎么展示
export type PermissionDenyDecision = {
  behavior: 'deny'
  message: string
  decisionReason: PermissionDecisionReason
  toolUseID?: string
}

/**
 * A permission decision - allow, ask, or deny
 */
// 三种判定的判别联合
export type PermissionDecision<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> =
  | PermissionAllowDecision<Input>
  | PermissionAskDecision<Input>
  | PermissionDenyDecision

/**
 * Permission result with additional passthrough option
 */
// 判定结果在判别联合之外多出一种 passthrough：用于子进程无法本地判定、必须透传给上层的情况
export type PermissionResult<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> =
  | PermissionDecision<Input>
  | {
      behavior: 'passthrough'
      message: string
      decisionReason?: PermissionDecision<Input>['decisionReason']
      suggestions?: PermissionUpdate[]
      blockedPath?: string
      /**
       * If set, an allow classifier check should be run asynchronously.
       * The classifier may auto-approve the permission before the user responds.
       */
      pendingClassifierCheck?: PendingClassifierCheck
    }

/**
 * Explanation of why a permission decision was made
 */
// 判定理由是一个大判别联合：覆盖规则命中、模式、子命令结果、钩子、分类器、沙箱覆盖等所有来源，是权限日志的主要结构
export type PermissionDecisionReason =
  | {
      type: 'rule'
      rule: PermissionRule
    }
  | {
      type: 'mode'
      mode: PermissionMode
    }
  | {
      type: 'subcommandResults'
      reasons: Map<string, PermissionResult>
    }
  | {
      type: 'permissionPromptTool'
      permissionPromptToolName: string
      toolResult: unknown
    }
  | {
      type: 'hook'
      hookName: string
      hookSource?: string
      reason?: string
    }
  | {
      type: 'asyncAgent'
      reason: string
    }
  | {
      type: 'sandboxOverride'
      reason: 'excludedCommand' | 'dangerouslyDisableSandbox'
    }
  | {
      type: 'classifier'
      classifier: string
      reason: string
    }
  | {
      type: 'workingDir'
      reason: string
    }
  | {
      type: 'safetyCheck'
      reason: string
      // When true, auto mode lets the classifier evaluate this instead of
      // forcing a prompt. True for sensitive-file paths (.claude/, .git/,
      // shell configs) — the classifier can see context and decide. False
      // for Windows path bypass attempts and cross-machine bridge messages.
      classifierApprovable: boolean
    }
  | {
      type: 'other'
      reason: string
    }

// ============================================================================
// Bash Classifier Types
// ============================================================================

// 分类器（安全评估模型）的返回：是否命中、命中的描述、置信度、理由
export type ClassifierResult = {
  matches: boolean
  matchedDescription?: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

// 分类器给出的三种处置：拒绝、询问、放行
export type ClassifierBehavior = 'deny' | 'ask' | 'allow'

// 分类器调用的 token 用量（含缓存读写），用于开销遥测
export type ClassifierUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}

// 自动模式分类器的详尽返回：除命中与否外，还带各阶段 token 用量、耗时、请求与消息 ID、错误落盘路径等，便于事后把提示词与判定对齐分析
export type YoloClassifierResult = {
  thinking?: string
  shouldBlock: boolean
  reason: string
  unavailable?: boolean
  /**
   * API returned "prompt is too long" — the classifier transcript exceeded
   * the context window. Deterministic (same transcript → same error), so
   * callers should fall back to normal prompting rather than retry/fail-closed.
   */
  transcriptTooLong?: boolean
  /** The model used for this classifier call */
  model: string
  /** Token usage from the classifier API call (for overhead telemetry) */
  usage?: ClassifierUsage
  /** Duration of the classifier API call in ms */
  durationMs?: number
  /** Character lengths of the prompt components sent to the classifier */
  promptLengths?: {
    systemPrompt: number
    toolCalls: number
    userPrompts: number
  }
  /** Path where error prompts were dumped (only set when unavailable due to API error) */
  errorDumpPath?: string
  /** Which classifier stage produced the final decision (2-stage XML only) */
  stage?: 'fast' | 'thinking'
  /** Token usage from stage 1 (fast) when stage 2 was also run */
  stage1Usage?: ClassifierUsage
  /** Duration of stage 1 in ms when stage 2 was also run */
  stage1DurationMs?: number
  /**
   * API request_id (req_xxx) for stage 1. Enables joining to server-side
   * api_usage logs for cache-miss / routing attribution. Also used for the
   * legacy 1-stage (tool_use) classifier — the single request goes here.
   */
  stage1RequestId?: string
  /**
   * API message id (msg_xxx) for stage 1. Enables joining the
   * tengu_auto_mode_decision analytics event to the classifier's actual
   * prompt/completion in post-analysis.
   */
  stage1MsgId?: string
  /** Token usage from stage 2 (thinking) when stage 2 was run */
  stage2Usage?: ClassifierUsage
  /** Duration of stage 2 in ms when stage 2 was run */
  stage2DurationMs?: number
  /** API request_id for stage 2 (set whenever stage 2 ran) */
  stage2RequestId?: string
  /** API message id (msg_xxx) for stage 2 (set whenever stage 2 ran) */
  stage2MsgId?: string
}

// ============================================================================
// Permission Explainer Types
// ============================================================================

// 风险等级三档：低、中、高
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

// 给用户的权限解释 = 风险等级 + 三段文案（解释 / 推理 / 风险）
export type PermissionExplanation = {
  riskLevel: RiskLevel
  explanation: string
  reasoning: string
  risk: string
}

// ============================================================================
// Tool Permission Context
// ============================================================================

/**
 * Mapping of permission rules by their source
 */
// 按来源分组的规则映射
export type ToolPermissionRulesBySource = {
  [T in PermissionRuleSource]?: string[]
}

/**
 * Context needed for permission checking in tools
 * Note: Uses a simplified DeepImmutable approximation for this types-only file
 */
// 工具做权限判定时需要的上下文：只读、纯数据（用近似的 DeepImmutable 包裹），不含任何函数，避免把运行时状态混进类型层
export type ToolPermissionContext = {
  readonly mode: PermissionMode
  readonly additionalWorkingDirectories: ReadonlyMap<
    string,
    AdditionalWorkingDirectory
  >
  readonly alwaysAllowRules: ToolPermissionRulesBySource
  readonly alwaysDenyRules: ToolPermissionRulesBySource
  readonly alwaysAskRules: ToolPermissionRulesBySource
  readonly isBypassPermissionsModeAvailable: boolean
  readonly strippedDangerousRules?: ToolPermissionRulesBySource
  readonly shouldAvoidPermissionPrompts?: boolean
  readonly awaitAutomatedChecksBeforeDialog?: boolean
  readonly prePlanMode?: PermissionMode
}
