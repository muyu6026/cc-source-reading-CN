import { feature } from 'bun:bundle'
// 引入 bun 的编译期 feature 开关宏 feature()；后续多个 beta 头常量据此决定取具体字符串还是空串。

export const CLAUDE_CODE_20250219_BETA_HEADER = 'claude-code-20250219'
// 最早的 beta 头常量（2025-02-19 版），作为历史基线保留；命名规则为「能力名 + 日期」。
export const INTERLEAVED_THINKING_BETA_HEADER =
  'interleaved-thinking-2025-05-14'
// 交错思考（interleaved-thinking）beta 头，日期 2025-05-14；开启后模型可在同一轮内交替生成思考与工具调用。
export const CONTEXT_1M_BETA_HEADER = 'context-1m-2025-08-07'
// 1M 上下文窗口 beta 头（2025-08-07）；允许单次请求携带百万级 token 上下文。
export const CONTEXT_MANAGEMENT_BETA_HEADER = 'context-management-2025-06-27'
// 上下文管理 beta 头（2025-06-27）；由客户端自主裁剪或压缩上下文。
export const STRUCTURED_OUTPUTS_BETA_HEADER = 'structured-outputs-2025-12-15'
// 结构化输出 beta 头（2025-12-15）；要求模型以受约束的结构化格式返回。
export const WEB_SEARCH_BETA_HEADER = 'web-search-2025-03-05'
// 联网搜索 beta 头（2025-03-05）。
// Tool search beta headers differ by provider:
// - Claude API / Foundry: advanced-tool-use-2025-11-20
// - Vertex AI / Bedrock: tool-search-tool-2025-10-19
// 工具搜索 beta 头因供应商而异：第一方与第三方使用不同的头名称，故拆分为两个常量（见下两行）。
export const TOOL_SEARCH_BETA_HEADER_1P = 'advanced-tool-use-2025-11-20'
// 第一方（Claude API / Foundry）使用的工具搜索 beta 头。
export const TOOL_SEARCH_BETA_HEADER_3P = 'tool-search-tool-2025-10-19'
// 第三方（Vertex AI / Bedrock）使用的工具搜索 beta 头。
export const EFFORT_BETA_HEADER = 'effort-2025-11-24'
// 推理努力程度（effort）beta 头（2025-11-24）。
export const TASK_BUDGETS_BETA_HEADER = 'task-budgets-2026-03-13'
// 任务预算（task-budgets）beta 头（2026-03-13），用于限定单任务资源消耗。
export const PROMPT_CACHING_SCOPE_BETA_HEADER =
  'prompt-caching-scope-2026-01-05'
// 提示缓存作用域（prompt-caching-scope）beta 头（2026-01-05）。
export const FAST_MODE_BETA_HEADER = 'fast-mode-2026-02-01'
// 快速模式（fast-mode）beta 头（2026-02-01），降低首字延迟。
export const REDACT_THINKING_BETA_HEADER = 'redact-thinking-2026-02-12'
// 思考内容脱敏（redact-thinking）beta 头（2026-02-12）。
export const TOKEN_EFFICIENT_TOOLS_BETA_HEADER =
  'token-efficient-tools-2026-03-28'
// 令牌高效工具（token-efficient-tools）beta 头（2026-03-28）。
export const SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER = feature('CONNECTOR_TEXT')
// 连接器文本摘要 beta 头：仅当 CONNECTOR_TEXT 开关开启时赋值为具体字符串，否则为空串。
  ? 'summarize-connector-text-2026-03-13'
  : ''
export const AFK_MODE_BETA_HEADER = feature('TRANSCRIPT_CLASSIFIER')
// 离开键盘（AFK）模式 beta 头：依赖 TRANSCRIPT_CLASSIFIER 开关，关闭时为空串。
  ? 'afk-mode-2026-01-31'
  : ''
export const CLI_INTERNAL_BETA_HEADER =
  process.env.USER_TYPE === 'ant' ? 'cli-internal-2026-02-09' : ''
// 仅内部蚂蚁（ant）用户生效的 CLI 内部 beta 头：通过环境变量 USER_TYPE 判定。
export const ADVISOR_BETA_HEADER = 'advisor-tool-2026-03-01'
// 顾问工具（advisor-tool）beta 头（2026-03-01）。

/**
 * Bedrock only supports a limited number of beta headers and only through
 * extraBodyParams. This set maintains the beta strings that should be in
 * Bedrock extraBodyParams *and not* in Bedrock headers.
 */
// 说明 Bedrock 只支持数量有限的 beta 头，且只能通过 extraBodyParams 下发，而不能放进请求头。
export const BEDROCK_EXTRA_PARAMS_HEADERS = new Set([
// Bedrock 额外参数头集合：仅收录那些需要走 extraBodyParams（而非请求头）的 beta 字符串。
  INTERLEAVED_THINKING_BETA_HEADER,
  CONTEXT_1M_BETA_HEADER,
  TOOL_SEARCH_BETA_HEADER_3P,
])

/**
 * Betas allowed on Vertex countTokens API.
 * Other betas will cause 400 errors.
 */
// 说明 Vertex 的 countTokens API 仅允许特定 beta 头，其他头会触发 400 错误。
export const VERTEX_COUNT_TOKENS_ALLOWED_BETAS = new Set([
// Vertex countTokens 允许的 beta 头集合；此处只放三个安全项。
  CLAUDE_CODE_20250219_BETA_HEADER,
  INTERLEAVED_THINKING_BETA_HEADER,
  CONTEXT_MANAGEMENT_BETA_HEADER,
])
