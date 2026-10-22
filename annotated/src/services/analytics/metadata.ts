// 【第 1-35 行】`metadata.ts` 是整个遥测子系统的**字段单一事实来源**：所有后端（Datadog / 1P）
//     共用的事件元数据，都在这里收集、整形、格式化。第 1 行 `biome-ignore-all` 注释是重点——
//     因为下面有几处 `ANT-ONLY import markers` 必须保持特定顺序（ant 构建独有的 import），
//     biome 的自动整理 import 会破坏它。→ 有时「看起来乱、但乱是有意的」代码，注释会告诉你别动。
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
/**
 * Shared event metadata enrichment for analytics systems
 *
 * This module provides a single source of truth for collecting and formatting
 * event metadata across all analytics systems (Datadog, 1P).
 */

import { extname } from 'path'
import memoize from 'lodash-es/memoize.js'
import { env, getHostPlatformForAnalytics } from '../../utils/env.js'
import { envDynamic } from '../../utils/envDynamic.js'
import { getModelBetas } from '../../utils/betas.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import {
  getSessionId,
  getIsInteractive,
  getKairosActive,
  getClientType,
  getParentSessionId as getParentSessionIdFromState,
} from '../../bootstrap/state.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isOfficialMcpUrl } from '../mcp/officialRegistry.js'
import { isClaudeAISubscriber, getSubscriptionType } from '../../utils/auth.js'
import { getRepoRemoteHash } from '../../utils/git.js'
import {
  getWslVersion,
  getLinuxDistroInfo,
  detectVcs,
} from '../../utils/platform.js'
import type { CoreUserData } from 'src/utils/user.js'
import { getAgentContext } from '../../utils/agentContext.js'
import type { EnvironmentMetadata } from '../../types/generated/events_mono/claude_code/v1/claude_code_internal_event.js'
import type { PublicApiAuth } from '../../types/generated/events_mono/common/v1/auth.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  getAgentId,
  getParentSessionId as getTeammateParentSessionId,
  getTeamName,
  isTeammate,
} from '../../utils/teammate.js'
import { feature } from 'bun:bundle'

/**
 * Marker type for verifying analytics metadata doesn't contain sensitive data
 *
 * This type forces explicit verification that string values being logged
 * don't contain code snippets, file paths, or other sensitive information.
 *
 * The metadata is expected to be JSON-serializable.
 *
 * Usage: `myString as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`
 *
 * The type is `never` which means it can never actually hold a value - this is
 * intentional as it's only used for type-casting to document developer intent.
 */
// 【第 44-57 行】又是 `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 这个 `never` 标记类型。
//     这里把它的设计意图讲得最透：**类型本身就是 `never`，永远不能真正持有值**，只用作类型转换
//     来「记录开发者的意图」。它把「这个 string 里没有代码/路径」这件事变成了一个**编译期可检查的声明**，
//     而不是靠 code review 人肉把关。整个 `analytics/` 反复出现，是这个子系统最重要的「命名即 lint」约定。
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never

/**
 * Sanitizes tool names for analytics logging to avoid PII exposure.
 *
 * MCP tool names follow the format `mcp__<server>__<tool>` and can reveal
 * user-specific server configurations, which is considered PII-medium.
 * This function redacts MCP tool names while preserving built-in tool names
 * (Bash, Read, Write, etc.) which are safe to log.
 *
 * @param toolName - The tool name to sanitize
 * @returns The original name for built-in tools, or 'mcp_tool' for MCP tools
 */
// 【第 59-77 行】`sanitizeToolNameForAnalytics` 把 MCP 工具名（`mcp__server__tool`）压成 `'mcp_tool'`，
//     但**保留**内置工具名（Bash / Read / Write 等）。注释说 MCP 名是 **PII-medium**：
//     因为 `server` 部分可能暴露「用户自己的 MCP 配置」（比如 `mcp__my-internal-company-tool`）。
//     → 同样是工具名，内置的是安全的、用户配置的是敏感的，脱敏口径要分。
export function sanitizeToolNameForAnalytics(
  toolName: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  if (toolName.startsWith('mcp__')) {
    return 'mcp_tool' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  }
  return toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if detailed tool name logging is enabled for OTLP events.
 * When enabled, MCP server/tool names and Skill names are logged.
 * Disabled by default to protect PII (user-specific server configurations).
 *
 * Enable with OTEL_LOG_TOOL_DETAILS=1
 */
export function isToolDetailsLoggingEnabled(): boolean {
  return isEnvTruthy(process.env.OTEL_LOG_TOOL_DETAILS)
}

/**
 * Check if detailed tool name logging (MCP server/tool names) is enabled
 * for analytics events.
 *
 * Per go/taxonomy, MCP names are medium PII. We log them for:
 * - Cowork (entrypoint=local-agent) — no ZDR concept, log all MCPs
 * - claude.ai-proxied connectors — always official (from claude.ai's list)
 * - Servers whose URL matches the official MCP registry — directory
 *   connectors added via `claude mcp add`, not customer-specific config
 *
 * Custom/user-configured MCPs stay sanitized (toolName='mcp_tool').
 */
// 【第 90-116 行】`isAnalyticsToolDetailsLoggingEnabled` 决定「**在什么情况下才允许记真实的 MCP 名**」，
//     给出了三个例外（都对应「这里没有用户特定泄露风险」）：
//     - Cowork 入口（`local-agent`）：没有 ZDR 概念，全记
//     - claude.ai 代理的连接器：永远来自 claude.ai 官方列表，不是用户配的
//     - URL 命中官方 MCP registry 的目录连接器（`claude mcp add` 加的，不是客户定制配置）
//     自定义 / 用户配置的 MCP 一律走脱敏。这是「**默认脱敏、按需放开**」的最小权限思路。
export function isAnalyticsToolDetailsLoggingEnabled(
  mcpServerType: string | undefined,
  mcpServerBaseUrl: string | undefined,
): boolean {
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent') {
    return true
  }
  if (mcpServerType === 'claudeai-proxy') {
    return true
  }
  if (mcpServerBaseUrl && isOfficialMcpUrl(mcpServerBaseUrl)) {
    return true
  }
  return false
}

/**
 * Built-in first-party MCP servers whose names are fixed reserved strings,
 * not user-configured — so logging them is not PII. Checked in addition to
 * isAnalyticsToolDetailsLoggingEnabled's transport/URL gates, which a stdio
 * built-in would otherwise fail.
 *
 * Feature-gated so the set is empty when the feature is off: the name
 * reservation (main.tsx, config.ts addMcpServer) is itself feature-gated, so
 * a user-configured 'computer-use' is possible in builds without the feature.
 */
// 【第 118-138 行】`BUILTIN_MCP_SERVER_NAMES` 是个**按 feature flag 门控 + 按需 require** 的集合：
//     只有 `feature('CHICAGO_MCP')` 开启时，才 `require(...).COMPUTER_USE_MCP_SERVER_NAME` 把一个保留名加进来。
//     注释解释为什么这么绕：这个保留名本身也是 feature-gated 的，所以在没开这个 feature 的构建里，
//     用户**可能**配置出一个同名 `computer-use`—— 必须和上面那个「URL/transport 门控」叠加判断，
//     stdio 型内置否则会漏过。门控 + require（而不是顶层静态 import）是为了**推迟 129KB 的加载**（只有需要时才读）。
/* eslint-disable @typescript-eslint/no-require-imports */
const BUILTIN_MCP_SERVER_NAMES: ReadonlySet<string> = new Set(
  feature('CHICAGO_MCP')
    ? [
        (
          require('../../utils/computerUse/common.js') as typeof import('../../utils/computerUse/common.js')
        ).COMPUTER_USE_MCP_SERVER_NAME,
      ]
    : [],
)
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Spreadable helper for logEvent payloads — returns {mcpServerName, mcpToolName}
 * if the gate passes, empty object otherwise. Consolidates the identical IIFE
 * pattern at each tengu_tool_use_* call site.
 */
export function mcpToolDetailsForAnalytics(
  toolName: string,
  mcpServerType: string | undefined,
  mcpServerBaseUrl: string | undefined,
): {
  mcpServerName?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  mcpToolName?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
} {
  const details = extractMcpToolDetails(toolName)
  if (!details) {
    return {}
  }
  if (
    !BUILTIN_MCP_SERVER_NAMES.has(details.serverName) &&
    !isAnalyticsToolDetailsLoggingEnabled(mcpServerType, mcpServerBaseUrl)
  ) {
    return {}
  }
  return {
    mcpServerName: details.serverName,
    mcpToolName: details.mcpToolName,
  }
}

/**
 * Extract MCP server and tool names from a full MCP tool name.
 * MCP tool names follow the format: mcp__<server>__<tool>
 *
 * @param toolName - The full tool name (e.g., 'mcp__slack__read_channel')
 * @returns Object with serverName and toolName, or undefined if not an MCP tool
 */
export function extractMcpToolDetails(toolName: string):
// 【第 176-206 行】`extractMcpToolDetails` 用 `split('__')` 拆 MCP 名。
//     注意第 194 行 `parts.slice(2).join('__')`：因为工具名**本身可能含 `__`**（比如 `mcp__slack__read__channel`），
//     所以不能简单取 `parts[2]`，要把第 3 个及以后的段重新拼回。这是个容易被 `parts[2]` 写错的地方，注释补了说明。
  | {
      serverName: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      mcpToolName: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    }
  | undefined {
  if (!toolName.startsWith('mcp__')) {
    return undefined
  }

  // Format: mcp__<server>__<tool>
  const parts = toolName.split('__')
  if (parts.length < 3) {
    return undefined
  }

  const serverName = parts[1]
  // Tool name may contain __ so rejoin remaining parts
  const mcpToolName = parts.slice(2).join('__')

  if (!serverName || !mcpToolName) {
    return undefined
  }

  return {
    serverName:
      serverName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    mcpToolName:
      mcpToolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  }
}

/**
 * Extract skill name from Skill tool input.
 *
 * @param toolName - The tool name (should be 'Skill')
 * @param input - The tool input containing the skill name
 * @returns The skill name if this is a Skill tool call, undefined otherwise
 */
export function extractSkillName(
  toolName: string,
  input: unknown,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  if (toolName !== 'Skill') {
    return undefined
  }

  if (
    typeof input === 'object' &&
    input !== null &&
    'skill' in input &&
    typeof (input as { skill: unknown }).skill === 'string'
  ) {
    return (input as { skill: string })
      .skill as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  }

  return undefined
}

const TOOL_INPUT_STRING_TRUNCATE_AT = 512
// 【第 236-283 行】`truncateToolInputValue` 对工具输入做**递归截断**：字符串超 512 截断到 128 + 标原长，
//     数组最多 20 项、对象最多 20 键、嵌套深度最多 2 层（第 239-240 行）。
//     第 272-273 行有个取证考量：过滤掉下划线开头的内部标记键（如 `_simulatedSedEdit`），
//     **不让它们漏进遥测**。截断的取舍是「保留有取证价值的字段（路径、URL、MCP 参数），但把体积压住」。
const TOOL_INPUT_STRING_TRUNCATE_TO = 128
const TOOL_INPUT_MAX_JSON_CHARS = 4 * 1024
const TOOL_INPUT_MAX_COLLECTION_ITEMS = 20
const TOOL_INPUT_MAX_DEPTH = 2

function truncateToolInputValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    if (value.length > TOOL_INPUT_STRING_TRUNCATE_AT) {
      return `${value.slice(0, TOOL_INPUT_STRING_TRUNCATE_TO)}…[${value.length} chars]`
    }
    return value
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return value
  }
  if (depth >= TOOL_INPUT_MAX_DEPTH) {
    return '<nested>'
  }
  if (Array.isArray(value)) {
    const mapped = value
      .slice(0, TOOL_INPUT_MAX_COLLECTION_ITEMS)
      .map(v => truncateToolInputValue(v, depth + 1))
    if (value.length > TOOL_INPUT_MAX_COLLECTION_ITEMS) {
      mapped.push(`…[${value.length} items]`)
    }
    return mapped
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // Skip internal marker keys (e.g. _simulatedSedEdit re-introduced by
      // SedEditPermissionRequest) so they don't leak into telemetry.
      .filter(([k]) => !k.startsWith('_'))
    const mapped = entries
      .slice(0, TOOL_INPUT_MAX_COLLECTION_ITEMS)
      .map(([k, v]) => [k, truncateToolInputValue(v, depth + 1)])
    if (entries.length > TOOL_INPUT_MAX_COLLECTION_ITEMS) {
      mapped.push(['…', `${entries.length} keys`])
    }
    return Object.fromEntries(mapped)
  }
  return String(value)
}

/**
 * Serialize a tool's input arguments for the OTel tool_result event.
 * Truncates long strings and deep nesting to keep the output bounded while
 * preserving forensically useful fields like file paths, URLs, and MCP args.
 * Returns undefined when OTEL_LOG_TOOL_DETAILS is not enabled.
 */
export function extractToolInputForTelemetry(
  input: unknown,
): string | undefined {
  if (!isToolDetailsLoggingEnabled()) {
    return undefined
  }
  const truncated = truncateToolInputValue(input)
  let json = jsonStringify(truncated)
  if (json.length > TOOL_INPUT_MAX_JSON_CHARS) {
    json = json.slice(0, TOOL_INPUT_MAX_JSON_CHARS) + '…[truncated]'
  }
  return json
}

/**
 * Maximum length for file extensions to be logged.
 * Extensions longer than this are considered potentially sensitive
 * (e.g., hash-based filenames like "key-hash-abcd-123-456") and
 * will be replaced with 'other'.
 */
// 【第 305-337 行】`getFileExtensionForAnalytics` 用 `path.extname` 取扩展名，但**超过 10 个字符的扩展名
//     一律记成 `'other'`**（第 311 行 `MAX_FILE_EXTENSION_LENGTH`）。
//     为什么？因为像 `key-hash-abcd-123-456` 这种「伪扩展名」（其实是哈希文件名）会暴露敏感信息，
//     且基数爆炸。和前面 `datadog.ts` 的「模型名超集归 'other'」是同一种防御：**把高基数 / 可能敏感的值压成常量**。
const MAX_FILE_EXTENSION_LENGTH = 10

/**
 * Extracts and sanitizes a file extension for analytics logging.
 *
 * Uses Node's path.extname for reliable cross-platform extension extraction.
 * Returns 'other' for extensions exceeding MAX_FILE_EXTENSION_LENGTH to avoid
 * logging potentially sensitive data (like hash-based filenames).
 *
 * @param filePath - The file path to extract the extension from
 * @returns The sanitized extension, 'other' for long extensions, or undefined if no extension
 */
export function getFileExtensionForAnalytics(
  filePath: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  const ext = extname(filePath).toLowerCase()
  if (!ext || ext === '.') {
    return undefined
  }

  const extension = ext.slice(1) // remove leading dot
  if (extension.length > MAX_FILE_EXTENSION_LENGTH) {
    return 'other' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  }

  return extension as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/** Allow list of commands we extract file extensions from. */
// 【第 339-364 行】`getFileExtensionsFromBashCommand` 是 best-effort 的 Bash 命令扩展名提取：
//     只在 `FILE_COMMANDS`（rm/mv/cp/cat/grep/rg/sed 等 18 个）的白名单里才扫参数（第 340-358 行），
//     且跳过以 `-` 开头的 flag（第 401 行 `charCodeAt(0) === 45`）。注释解释为什么不做重型 shell 解析：
//     grep 的正则、sed 的脚本几乎不会被误判成文件路径，所以轻量启发式足够。→ 「够用就好」比「完美解析」更划算。
const FILE_COMMANDS = new Set([
  'rm',
  'mv',
  'cp',
  'touch',
  'mkdir',
  'chmod',
  'chown',
  'cat',
  'head',
  'tail',
  'sort',
  'stat',
  'diff',
  'wc',
  'grep',
  'rg',
  'sed',
])

/** Regex to split bash commands on compound operators (&&, ||, ;, |). */
const COMPOUND_OPERATOR_REGEX = /\s*(?:&&|\|\||[;|])\s*/

/** Regex to split on whitespace. */
const WHITESPACE_REGEX = /\s+/

/**
 * Extracts file extensions from a bash command for analytics.
 * Best-effort: splits on operators and whitespace, extracts extensions
 * from non-flag args of allowed commands. No heavy shell parsing needed
 * because grep patterns and sed scripts rarely resemble file extensions.
 */
export function getFileExtensionsFromBashCommand(
  command: string,
  simulatedSedEditFilePath?: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  if (!command.includes('.') && !simulatedSedEditFilePath) return undefined

  let result: string | undefined
  const seen = new Set<string>()

  if (simulatedSedEditFilePath) {
    const ext = getFileExtensionForAnalytics(simulatedSedEditFilePath)
    if (ext) {
      seen.add(ext)
      result = ext
    }
  }

  for (const subcmd of command.split(COMPOUND_OPERATOR_REGEX)) {
    if (!subcmd) continue
    const tokens = subcmd.split(WHITESPACE_REGEX)
    if (tokens.length < 2) continue

    const firstToken = tokens[0]!
    const slashIdx = firstToken.lastIndexOf('/')
    const baseCmd = slashIdx >= 0 ? firstToken.slice(slashIdx + 1) : firstToken
    if (!FILE_COMMANDS.has(baseCmd)) continue

    for (let i = 1; i < tokens.length; i++) {
      const arg = tokens[i]!
      if (arg.charCodeAt(0) === 45 /* - */) continue
      const ext = getFileExtensionForAnalytics(arg)
      if (ext && !seen.has(ext)) {
        seen.add(ext)
        result = result ? result + ',' + ext : ext
      }
    }
  }

  if (!result) return undefined
  return result as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Environment context metadata
 */
export type EnvContext = {
  platform: string
  platformRaw: string
  arch: string
  nodeVersion: string
  terminal: string | null
  packageManagers: string
  runtimes: string
  isRunningWithBun: boolean
  isCi: boolean
  isClaubbit: boolean
  isClaudeCodeRemote: boolean
  isLocalAgentMode: boolean
  isConductor: boolean
  remoteEnvironmentType?: string
  coworkerType?: string
  claudeCodeContainerId?: string
  claudeCodeRemoteSessionId?: string
  tags?: string
  isGithubAction: boolean
  isClaudeCodeAction: boolean
  isClaudeAiAuth: boolean
  version: string
  versionBase?: string
  buildTime: string
  deploymentEnvironment: string
  githubEventName?: string
  githubActionsRunnerEnvironment?: string
  githubActionsRunnerOs?: string
  githubActionRef?: string
  wslVersion?: string
  linuxDistroId?: string
  linuxDistroVersion?: string
  linuxKernel?: string
  vcs?: string
}

/**
 * Process metrics included with all analytics events.
 */
export type ProcessMetrics = {
  uptime: number
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
  constrainedMemory: number | undefined
  cpuUsage: NodeJS.CpuUsage
  cpuPercent: number | undefined
}

/**
 * Core event metadata shared across all analytics systems
 */
export type EventMetadata = {
  model: string
  sessionId: string
  userType: string
  betas?: string
  envContext: EnvContext
  entrypoint?: string
  agentSdkVersion?: string
  isInteractive: string
  clientType: string
  processMetrics?: ProcessMetrics
  sweBenchRunId: string
  sweBenchInstanceId: string
  sweBenchTaskId: string
  // Swarm/team agent identification for analytics attribution
  agentId?: string // CLAUDE_CODE_AGENT_ID (format: agentName@teamName) or subagent UUID
  parentSessionId?: string // CLAUDE_CODE_PARENT_SESSION_ID (team lead's session)
  agentType?: 'teammate' | 'subagent' | 'standalone' // Distinguishes swarm teammates, Agent tool subagents, and standalone agents
  teamName?: string // Team name for swarm agents (from env var or AsyncLocalStorage)
  subscriptionType?: string // OAuth subscription tier (max, pro, enterprise, team)
  rh?: string // Hashed repo remote URL (first 16 chars of SHA256), for joining with server-side data
  kairosActive?: true // KAIROS assistant mode active (ant-only; set in main.tsx after gate check)
  skillMode?: 'discovery' | 'coach' | 'discovery_and_coach' // Which skill surfacing mechanism(s) are gated on (ant-only; for BQ session segmentation)
  observerMode?: 'backseat' | 'skillcoach' | 'both' // Which observer classifiers are gated on (ant-only; for BQ cohort splits on tengu_backseat_* events)
}

/**
 * Options for enriching event metadata
 */
export type EnrichMetadataOptions = {
  // Model to use, falls back to getMainLoopModel() if not provided
  model?: unknown
  // Explicit betas string (already joined)
  betas?: unknown
  // Additional metadata to include (optional)
  additionalMetadata?: Record<string, unknown>
}

/**
 * Get agent identification for analytics.
 * Priority: AsyncLocalStorage context (subagents) > env vars (swarm teammates)
 */
// 【第 510-561 行】`getAgentIdentification` 的**优先级链**写得很清楚（也是注释明说的）：
//     AsyncLocalStorage 上下文（同进程里的 subagent）> 环境变量（swarm teammates）> bootstrap state（plan→impl 的 parent session）。
//     第 539-544 行对「standalone agent」的判定：有 agentId 但不是 teammate，才算 standalone。
//     这种「多来源、按可信度排序、逐级回退」是配置/身份解析的常见模式。
function getAgentIdentification(): {
  agentId?: string
  parentSessionId?: string
  agentType?: 'teammate' | 'subagent' | 'standalone'
  teamName?: string
} {
  // Check AsyncLocalStorage first (for subagents running in same process)
  const agentContext = getAgentContext()
  if (agentContext) {
    const result: ReturnType<typeof getAgentIdentification> = {
      agentId: agentContext.agentId,
      parentSessionId: agentContext.parentSessionId,
      agentType: agentContext.agentType,
    }
    if (agentContext.agentType === 'teammate') {
      result.teamName = agentContext.teamName
    }
    return result
  }

  // Fall back to swarm helpers (for swarm agents)
  const agentId = getAgentId()
  const parentSessionId = getTeammateParentSessionId()
  const teamName = getTeamName()
  const isSwarmAgent = isTeammate()
  // For standalone agents (have agent ID but not a teammate), set agentType to 'standalone'
  const agentType = isSwarmAgent
    ? ('teammate' as const)
    : agentId
      ? ('standalone' as const)
      : undefined
  if (agentId || agentType || parentSessionId || teamName) {
    return {
      ...(agentId ? { agentId } : {}),
      ...(agentType ? { agentType } : {}),
      ...(parentSessionId ? { parentSessionId } : {}),
      ...(teamName ? { teamName } : {}),
    }
  }

  // Check bootstrap state for parent session ID (e.g., plan mode -> implementation)
  const stateParentSessionId = getParentSessionIdFromState()
  if (stateParentSessionId) {
    return { parentSessionId: stateParentSessionId }
  }

  return {}
}

/**
 * Extract base version from full version string. "2.0.36-dev.20251107.t174150.sha2709699" → "2.0.36-dev"
 */
// 【第 563-569 行】`getVersionBase` 用 `memoize` 把 `MACRO.VERSION` 里的前三段（`2.0.36-dev`）抽出来缓存。
//     正则 `^\d+\.\d+\.\d+(?:-[a-z]+)?` 既吃正式版也吃 dev 版。memoize 在这里是「解析结果只算一次」。
const getVersionBase = memoize((): string | undefined => {
  const match = MACRO.VERSION.match(/^\d+\.\d+\.\d+(?:-[a-z]+)?/)
  return match ? match[0] : undefined
})

/**
 * Builds the environment context object
 */
// 【第 571-638 行】`buildEnvContext` 是 `memoize(async ...)`，一次性收集平台/架构/包管理器/CI/distro/vcs 等。
//     第 584-587 行有个细微但重要的点：`platformRaw` 用**原始** `process.platform`（freebsd/openbsd 等），
//     而 `platform` 用 `getHostPlatformForAnalytics()`（把那些归并成 'linux'）—— 同一个事实，两个字段，
//     一个给你真相、一个给你可聚合的桶。`versionBase` 故意**不**进这个 memoized env（第 732 行注释解释：
//     `setKairosActive()` 在 main.tsx 首次事件之后才跑，env 已经被缓存，所以 kairosActive 要每次事件现读）。
const buildEnvContext = memoize(async (): Promise<EnvContext> => {
  const [packageManagers, runtimes, linuxDistroInfo, vcs] = await Promise.all([
    env.getPackageManagers(),
    env.getRuntimes(),
    getLinuxDistroInfo(),
    detectVcs(),
  ])

  return {
    platform: getHostPlatformForAnalytics(),
    // Raw process.platform so freebsd/openbsd/aix/sunos are visible in BQ.
    // getHostPlatformForAnalytics() buckets those into 'linux'; here we want
    // the truth. CLAUDE_CODE_HOST_PLATFORM still overrides for container/remote.
    platformRaw: process.env.CLAUDE_CODE_HOST_PLATFORM || process.platform,
    arch: env.arch,
    nodeVersion: env.nodeVersion,
    terminal: envDynamic.terminal,
    packageManagers: packageManagers.join(','),
    runtimes: runtimes.join(','),
    isRunningWithBun: env.isRunningWithBun(),
    isCi: isEnvTruthy(process.env.CI),
    isClaubbit: isEnvTruthy(process.env.CLAUBBIT),
    isClaudeCodeRemote: isEnvTruthy(process.env.CLAUDE_CODE_REMOTE),
    isLocalAgentMode: process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent',
    isConductor: env.isConductor(),
    ...(process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE && {
      remoteEnvironmentType: process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE,
    }),
    // Gated by feature flag to prevent leaking "coworkerType" string in external builds
    ...(feature('COWORKER_TYPE_TELEMETRY')
      ? process.env.CLAUDE_CODE_COWORKER_TYPE
        ? { coworkerType: process.env.CLAUDE_CODE_COWORKER_TYPE }
        : {}
      : {}),
    ...(process.env.CLAUDE_CODE_CONTAINER_ID && {
      claudeCodeContainerId: process.env.CLAUDE_CODE_CONTAINER_ID,
    }),
    ...(process.env.CLAUDE_CODE_REMOTE_SESSION_ID && {
      claudeCodeRemoteSessionId: process.env.CLAUDE_CODE_REMOTE_SESSION_ID,
    }),
    ...(process.env.CLAUDE_CODE_TAGS && {
      tags: process.env.CLAUDE_CODE_TAGS,
    }),
    isGithubAction: isEnvTruthy(process.env.GITHUB_ACTIONS),
    isClaudeCodeAction: isEnvTruthy(process.env.CLAUDE_CODE_ACTION),
    isClaudeAiAuth: isClaudeAISubscriber(),
    version: MACRO.VERSION,
    versionBase: getVersionBase(),
    buildTime: MACRO.BUILD_TIME,
    deploymentEnvironment: env.detectDeploymentEnvironment(),
    ...(isEnvTruthy(process.env.GITHUB_ACTIONS) && {
      githubEventName: process.env.GITHUB_EVENT_NAME,
      githubActionsRunnerEnvironment: process.env.RUNNER_ENVIRONMENT,
      githubActionsRunnerOs: process.env.RUNNER_OS,
      githubActionRef: process.env.GITHUB_ACTION_PATH?.includes(
        'claude-code-action/',
      )
        ? process.env.GITHUB_ACTION_PATH.split('claude-code-action/')[1]
        : undefined,
    }),
    ...(getWslVersion() && { wslVersion: getWslVersion() }),
    ...(linuxDistroInfo ?? {}),
    ...(vcs.length > 0 ? { vcs: vcs.join(',') } : {}),
  }
})

// --
// CPU% delta tracking — inherently process-global, same pattern as logBatch/flushTimer in datadog.ts
// 【第 640-682 行】CPU% 的**增量追踪**用两个模块级变量（`prevCpuUsage` / `prevWallTimeMs`），
//     注释说「inherently process-global，和 datadog.ts 的 logBatch/flushTimer 同一种模式」。
//     第 654-662 行：CPU 百分比 = 两次采样的 user+system 微秒差 / 墙钟毫秒差 / 1000 * 100。
//     这种「差值」算法必须保住上一次的状态，所以放在模块级、不能进 memoized 函数。
//     `buildProcessMetrics` 整个包在 try 里，失败返回 undefined（metrics 丢了不影响主流程）。
let prevCpuUsage: NodeJS.CpuUsage | null = null
let prevWallTimeMs: number | null = null

/**
 * Builds process metrics object for all users.
 */
function buildProcessMetrics(): ProcessMetrics | undefined {
  try {
    const mem = process.memoryUsage()
    const cpu = process.cpuUsage()
    const now = Date.now()

    let cpuPercent: number | undefined
    if (prevCpuUsage && prevWallTimeMs) {
      const wallDeltaMs = now - prevWallTimeMs
      if (wallDeltaMs > 0) {
        const userDeltaUs = cpu.user - prevCpuUsage.user
        const systemDeltaUs = cpu.system - prevCpuUsage.system
        cpuPercent =
          ((userDeltaUs + systemDeltaUs) / (wallDeltaMs * 1000)) * 100
      }
    }
    prevCpuUsage = cpu
    prevWallTimeMs = now

    return {
      uptime: process.uptime(),
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      constrainedMemory: process.constrainedMemory(),
      cpuUsage: cpu,
      cpuPercent,
    }
  } catch {
    return undefined
  }
}

/**
 * Get core event metadata shared across all analytics systems.
 *
 * This function collects environment, runtime, and context information
 * that should be included with all analytics events.
 *
 * @param options - Configuration options
 * @returns Promise resolving to enriched metadata object
 */
// 【第 693-743 行】`getEventMetadata` 是**所有**遥测事件共用的核心收集函数，返回 `EventMetadata`。
//     它 `Promise.all` 并行取 `buildEnvContext`（memoized）和 `getRepoRemoteHash`，再取 process metrics。
//     第 725-739 行把 agent 身份、`subscriptionType`、`kairosActive`、`rh`（仓库远程 URL 哈希）等按需展开——
//     注意 `kairosActive` 走 `feature('KAIROS') && getKairosActive()`（现读），印证了上面第 584 行说的「不进 memoized env」。
export async function getEventMetadata(
  options: EnrichMetadataOptions = {},
): Promise<EventMetadata> {
  const model = options.model ? String(options.model) : getMainLoopModel()
  const betas =
    typeof options.betas === 'string'
      ? options.betas
      : getModelBetas(model).join(',')
  const [envContext, repoRemoteHash] = await Promise.all([
    buildEnvContext(),
    getRepoRemoteHash(),
  ])
  const processMetrics = buildProcessMetrics()

  const metadata: EventMetadata = {
    model,
    sessionId: getSessionId(),
    userType: process.env.USER_TYPE || '',
    ...(betas.length > 0 ? { betas: betas } : {}),
    envContext,
    ...(process.env.CLAUDE_CODE_ENTRYPOINT && {
      entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT,
    }),
    ...(process.env.CLAUDE_AGENT_SDK_VERSION && {
      agentSdkVersion: process.env.CLAUDE_AGENT_SDK_VERSION,
    }),
    isInteractive: String(getIsInteractive()),
    clientType: getClientType(),
    ...(processMetrics && { processMetrics }),
    sweBenchRunId: process.env.SWE_BENCH_RUN_ID || '',
    sweBenchInstanceId: process.env.SWE_BENCH_INSTANCE_ID || '',
    sweBenchTaskId: process.env.SWE_BENCH_TASK_ID || '',
    // Swarm/team agent identification
    // Priority: AsyncLocalStorage context (subagents) > env vars (swarm teammates)
    ...getAgentIdentification(),
    // Subscription tier for DAU-by-tier analytics
    ...(getSubscriptionType() && {
      subscriptionType: getSubscriptionType()!,
    }),
    // Assistant mode tag — lives outside memoized buildEnvContext() because
    // setKairosActive() runs at main.tsx:~1648, after the first event may
    // have already fired and memoized the env. Read fresh per-event instead.
    ...(feature('KAIROS') && getKairosActive()
      ? { kairosActive: true as const }
      : {}),
    // Repo remote hash for joining with server-side repo bundle data
    ...(repoRemoteHash && { rh: repoRemoteHash }),
  }

  return metadata
}


/**
 * Core event metadata for 1P event logging (snake_case format).
 */
// 【第 746-784 行】两套 1P 格式类型：`FirstPartyEventLoggingCoreMetadata`（snake_case 的核心字段）
//     和 `FirstPartyEventLoggingMetadata`（env + process + auth + core + additional 的完整包）。
//     第 774-776 行注释：**`account_id` 故意省略**，只客户端填 UUID 字段（account_uuid / organization_uuid）——
//     这是数据最小化：客户端不该自己宣称 account_id（那是服务端权威字段），只给它能确定的 UUID。
export type FirstPartyEventLoggingCoreMetadata = {
  session_id: string
  model: string
  user_type: string
  betas?: string
  entrypoint?: string
  agent_sdk_version?: string
  is_interactive: boolean
  client_type: string
  swe_bench_run_id?: string
  swe_bench_instance_id?: string
  swe_bench_task_id?: string
  // Swarm/team agent identification
  agent_id?: string
  parent_session_id?: string
  agent_type?: 'teammate' | 'subagent' | 'standalone'
  team_name?: string
}

/**
 * Complete event logging metadata format for 1P events.
 */
export type FirstPartyEventLoggingMetadata = {
  env: EnvironmentMetadata
  process?: string
  // auth is a top-level field on ClaudeCodeInternalEvent (proto PublicApiAuth).
  // account_id is intentionally omitted — only UUID fields are populated client-side.
  auth?: PublicApiAuth
  // core fields correspond to the top level of ClaudeCodeInternalEvent.
  // They get directly exported to their individual columns in the BigQuery tables
  core: FirstPartyEventLoggingCoreMetadata
  // additional fields are populated in the additional_metadata field of the
  // ClaudeCodeInternalEvent proto. Includes but is not limited to information
  // that differs by event type.
  additional: Record<string, unknown>
}

/**
 * Convert metadata to 1P event logging format (snake_case fields).
 *
 * The /api/event_logging/batch endpoint expects snake_case field names
 * for environment and core metadata.
 *
 * @param metadata - Core event metadata
 * @param additionalMetadata - Additional metadata to include
 * @returns Metadata formatted for 1P event logging
 */
// 【第 796-973 行】`to1PEventFormat` 把 camelCase 的 `EventMetadata` 翻成 snake_case 给 BigQuery。
//     这是整个文件里**注释最重**的一段，因为它踩过的坑最多：
//     - 第 811-819 行：`env` 用** proto 生成的类型** `EnvironmentMetadata`，而不是手写并行类型——
//       因为手写的版本曾让 #11318 / #13924 / #19448 / coworker_type **这四批字段悄悄没进 BQ**
//       （生成代码的 `toJSON()` 会静默丢未知键，手写类型不会在编译期报错）。所以「加字段必须先改 monorepo proto，
//       再 `bun run generate:proto`」是硬约束。
//     - 第 935-948 行：从 `userMetadata` 取 `githubActionsMetadata` 和 `auth`，同样映射到 proto 类型。
//     - 第 958-972 行：`process` 字段把 process metrics **base64(JSON)** 后塞进去（体积大，所以编码），
//       `additional` 收 `rh` / `kairosActive` / `skillMode` / `observerMode` 等「差异字段」。
//     → 这段是「**类型系统能查的，绝不靠人记**」的最佳范例：用 proto 生成类型把「漏字段」从运行时 bug 变成编译错误。
export function to1PEventFormat(
  metadata: EventMetadata,
  userMetadata: CoreUserData,
  additionalMetadata: Record<string, unknown> = {},
): FirstPartyEventLoggingMetadata {
  const {
    envContext,
    processMetrics,
    rh,
    kairosActive,
    skillMode,
    observerMode,
    ...coreFields
  } = metadata

  // Convert envContext to snake_case.
  // IMPORTANT: env is typed as the proto-generated EnvironmentMetadata so that
  // adding a field here that the proto doesn't define is a compile error. The
  // generated toJSON() serializer silently drops unknown keys — a hand-written
  // parallel type previously let #11318, #13924, #19448, and coworker_type all
  // ship fields that never reached BQ.
  // Adding a field? Update the monorepo proto first (go/cc-logging):
  //   event_schemas/.../claude_code/v1/claude_code_internal_event.proto
  // then run `bun run generate:proto` here.
  const env: EnvironmentMetadata = {
    platform: envContext.platform,
    platform_raw: envContext.platformRaw,
    arch: envContext.arch,
    node_version: envContext.nodeVersion,
    terminal: envContext.terminal || 'unknown',
    package_managers: envContext.packageManagers,
    runtimes: envContext.runtimes,
    is_running_with_bun: envContext.isRunningWithBun,
    is_ci: envContext.isCi,
    is_claubbit: envContext.isClaubbit,
    is_claude_code_remote: envContext.isClaudeCodeRemote,
    is_local_agent_mode: envContext.isLocalAgentMode,
    is_conductor: envContext.isConductor,
    is_github_action: envContext.isGithubAction,
    is_claude_code_action: envContext.isClaudeCodeAction,
    is_claude_ai_auth: envContext.isClaudeAiAuth,
    version: envContext.version,
    build_time: envContext.buildTime,
    deployment_environment: envContext.deploymentEnvironment,
  }

  // Add optional env fields
  if (envContext.remoteEnvironmentType) {
    env.remote_environment_type = envContext.remoteEnvironmentType
  }
  if (feature('COWORKER_TYPE_TELEMETRY') && envContext.coworkerType) {
    env.coworker_type = envContext.coworkerType
  }
  if (envContext.claudeCodeContainerId) {
    env.claude_code_container_id = envContext.claudeCodeContainerId
  }
  if (envContext.claudeCodeRemoteSessionId) {
    env.claude_code_remote_session_id = envContext.claudeCodeRemoteSessionId
  }
  if (envContext.tags) {
    env.tags = envContext.tags
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
  }
  if (envContext.githubEventName) {
    env.github_event_name = envContext.githubEventName
  }
  if (envContext.githubActionsRunnerEnvironment) {
    env.github_actions_runner_environment =
      envContext.githubActionsRunnerEnvironment
  }
  if (envContext.githubActionsRunnerOs) {
    env.github_actions_runner_os = envContext.githubActionsRunnerOs
  }
  if (envContext.githubActionRef) {
    env.github_action_ref = envContext.githubActionRef
  }
  if (envContext.wslVersion) {
    env.wsl_version = envContext.wslVersion
  }
  if (envContext.linuxDistroId) {
    env.linux_distro_id = envContext.linuxDistroId
  }
  if (envContext.linuxDistroVersion) {
    env.linux_distro_version = envContext.linuxDistroVersion
  }
  if (envContext.linuxKernel) {
    env.linux_kernel = envContext.linuxKernel
  }
  if (envContext.vcs) {
    env.vcs = envContext.vcs
  }
  if (envContext.versionBase) {
    env.version_base = envContext.versionBase
  }

  // Convert core fields to snake_case
  const core: FirstPartyEventLoggingCoreMetadata = {
    session_id: coreFields.sessionId,
    model: coreFields.model,
    user_type: coreFields.userType,
    is_interactive: coreFields.isInteractive === 'true',
    client_type: coreFields.clientType,
  }

  // Add other core fields
  if (coreFields.betas) {
    core.betas = coreFields.betas
  }
  if (coreFields.entrypoint) {
    core.entrypoint = coreFields.entrypoint
  }
  if (coreFields.agentSdkVersion) {
    core.agent_sdk_version = coreFields.agentSdkVersion
  }
  if (coreFields.sweBenchRunId) {
    core.swe_bench_run_id = coreFields.sweBenchRunId
  }
  if (coreFields.sweBenchInstanceId) {
    core.swe_bench_instance_id = coreFields.sweBenchInstanceId
  }
  if (coreFields.sweBenchTaskId) {
    core.swe_bench_task_id = coreFields.sweBenchTaskId
  }
  // Swarm/team agent identification
  if (coreFields.agentId) {
    core.agent_id = coreFields.agentId
  }
  if (coreFields.parentSessionId) {
    core.parent_session_id = coreFields.parentSessionId
  }
  if (coreFields.agentType) {
    core.agent_type = coreFields.agentType
  }
  if (coreFields.teamName) {
    core.team_name = coreFields.teamName
  }

  // Map userMetadata to output fields.
  // Based on src/utils/user.ts getUser(), but with fields present in other
  // parts of ClaudeCodeInternalEvent deduplicated.
  // Convert camelCase GitHubActionsMetadata to snake_case for 1P API
  // Note: github_actions_metadata is placed inside env (EnvironmentMetadata)
  // rather than at the top level of ClaudeCodeInternalEvent
  if (userMetadata.githubActionsMetadata) {
    const ghMeta = userMetadata.githubActionsMetadata
    env.github_actions_metadata = {
      actor_id: ghMeta.actorId,
      repository_id: ghMeta.repositoryId,
      repository_owner_id: ghMeta.repositoryOwnerId,
    }
  }

  let auth: PublicApiAuth | undefined
  if (userMetadata.accountUuid || userMetadata.organizationUuid) {
    auth = {
      account_uuid: userMetadata.accountUuid,
      organization_uuid: userMetadata.organizationUuid,
    }
  }

  return {
    env,
    ...(processMetrics && {
      process: Buffer.from(jsonStringify(processMetrics)).toString('base64'),
    }),
    ...(auth && { auth }),
    core,
    additional: {
      ...(rh && { rh }),
      ...(kairosActive && { is_assistant_mode: true }),
      ...(skillMode && { skill_mode: skillMode }),
      ...(observerMode && { observer_mode: observerMode }),
      ...additionalMetadata,
    },
  }
}
