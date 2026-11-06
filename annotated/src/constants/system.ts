// 为打破循环依赖而抽出的最底层系统常量。
// Critical system constants extracted to break circular dependencies

import { feature } from 'bun:bundle'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logForDebugging } from '../utils/debug.js'
import { isEnvDefinedFalsy } from '../utils/envUtils.js'
import { getAPIProvider } from '../utils/model/providers.js'
import { getWorkload } from '../utils/workloadContext.js'

// 三套系统提示前缀：CLI 默认 / SDK 预设 / SDK 通用。
const DEFAULT_PREFIX = `You are Claude Code, Anthropic's official CLI for Claude.`
const AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX = `You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.`
const AGENT_SDK_PREFIX = `You are a Claude agent, built on Anthropic's Claude Agent SDK.`

const CLI_SYSPROMPT_PREFIX_VALUES = [
  DEFAULT_PREFIX,
  AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX,
  AGENT_SDK_PREFIX,
] as const

// 由前缀常量元组推导出的前缀字面量类型。
export type CLISyspromptPrefix = (typeof CLI_SYSPROMPT_PREFIX_VALUES)[number]

/**
 * All possible CLI sysprompt prefix values, used by splitSysPromptPrefix
 * to identify prefix blocks by content rather than position.
 */
// 以只读集合导出全部前缀，便于按内容识别。
export const CLI_SYSPROMPT_PREFIXES: ReadonlySet<string> = new Set(
  CLI_SYSPROMPT_PREFIX_VALUES,
)

// 根据环境选择恰当的 CLI 系统提示前缀。
export function getCLISyspromptPrefix(options?: {
  isNonInteractive: boolean
  hasAppendSystemPrompt: boolean
}): CLISyspromptPrefix {
  const apiProvider = getAPIProvider()
// vertex 后端固定用默认前缀。
  if (apiProvider === 'vertex') {
    return DEFAULT_PREFIX
  }

  if (options?.isNonInteractive) {
// 非交互场景区分 SDK 预设与通用前缀。
    if (options.hasAppendSystemPrompt) {
      return AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX
    }
    return AGENT_SDK_PREFIX
  }
  return DEFAULT_PREFIX
}

/**
 * Check if attribution header is enabled.
 * Enabled by default, can be disabled via env var or GrowthBook killswitch.
 */
// 判断归属头是否启用：环境变量优先关，否则读实验开关。
function isAttributionHeaderEnabled(): boolean {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_ATTRIBUTION_HEADER)) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_attribution_header', true)
}

/**
 * Get attribution header for API requests.
 * Returns a header string with cc_version (including fingerprint) and cc_entrypoint.
 * Enabled by default, can be disabled via env var or GrowthBook killswitch.
 *
 * When NATIVE_CLIENT_ATTESTATION is enabled, includes a `cch=00000` placeholder.
 * Before the request is sent, Bun's native HTTP stack finds this placeholder
 * in the request body and overwrites the zeros with a computed hash. The
 * server verifies this token to confirm the request came from a real Claude
 * Code client. See bun-anthropic/src/http/Attestation.zig for implementation.
 *
 * We use a placeholder (instead of injecting from Zig) because same-length
 * replacement avoids Content-Length changes and buffer reallocation.
 */
// 构造 API 请求的归属头（版本指纹 + 入口点 + 可选项）。
export function getAttributionHeader(fingerprint: string): string {
  if (!isAttributionHeaderEnabled()) {
    return ''
  }

  const version = `${MACRO.VERSION}.${fingerprint}`
// 版本由宏版本号拼上指纹组成。
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT ?? 'unknown'

  // cch=00000 placeholder is overwritten by Bun's HTTP stack with attestation token
  const cch = feature('NATIVE_CLIENT_ATTESTATION') ? ' cch=00000;' : ''
// 原生证明开启时嵌入 cch 占位符，由 Bun HTTP 栈回填。
  // cc_workload: turn-scoped hint so the API can route e.g. cron-initiated
  // requests to a lower QoS pool. Absent = interactive default. Safe re:
  // fingerprint (computed from msg chars + version only, line 78 above) and
  // cch attestation (placeholder overwritten in serialized body bytes after
  // this string is built). Server _parse_cc_header tolerates unknown extra
  // fields so old API deploys silently ignore this.
  const workload = getWorkload()
// 按轮次作用域注入工作负载提示，路由到低 QoS 池。
  const workloadPair = workload ? ` cc_workload=${workload};` : ''
  const header = `x-anthropic-billing-header: cc_version=${version}; cc_entrypoint=${entrypoint};${cch}${workloadPair}`
// 拼接成 x-anthropic-billing-header 计费头字符串。

  logForDebugging(`attribution header ${header}`)
  return header
}
