// 本文件定义 ant 内部专用（ANT-ONLY）模型的相关类型与读取函数，仅当 `USER_TYPE` 为 `ant` 时才返回真实数据，否则一律回落到空或 `null`。
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import type { EffortLevel } from '../effort.js'

// `AntModel` 描述单个 ant 模型：别名、实际模型名、标签、描述，以及默认思考力度、上下文窗口、最大 token 等可选能力字段。
export type AntModel = {
  alias: string
  model: string
  label: string
  description?: string
  defaultEffortValue?: number
  defaultEffortLevel?: EffortLevel
  contextWindow?: number
  defaultMaxTokens?: number
  upperMaxTokensLimit?: number
  /** Model defaults to adaptive thinking and rejects `thinking: { type: 'disabled' }`. */
  alwaysOnThinking?: boolean
}

export type AntModelSwitchCalloutConfig = {
  modelAlias?: string
  description: string
  version: string
}

export type AntModelOverrideConfig = {
  defaultModel?: string
  defaultModelEffortLevel?: EffortLevel
  defaultSystemPromptSuffix?: string
  antModels?: AntModel[]
  switchCallout?: AntModelSwitchCalloutConfig
}

// @[MODEL LAUNCH]: Update tengu_ant_model_override with new ant-only models
// @[MODEL LAUNCH]: Add the codename to scripts/excluded-strings.txt to prevent it from leaking to external builds.
// `getAntModelOverrideConfig` 从特性开关读取 ant 模型覆盖配置；非 ant 用户直接返回 `null`。
export function getAntModelOverrideConfig(): AntModelOverrideConfig | null {
  if (process.env.USER_TYPE !== 'ant') {
    return null
  }
  return getFeatureValue_CACHED_MAY_BE_STALE<AntModelOverrideConfig | null>(
    'tengu_ant_model_override',
    null,
  )
}

// `getAntModels` 返回全部 ant 模型列表，非 ant 用户返回空数组。
export function getAntModels(): AntModel[] {
  if (process.env.USER_TYPE !== 'ant') {
    return []
  }
  return getAntModelOverrideConfig()?.antModels ?? []
}

// `resolveAntModel` 按精确别名或包含实际模型名的方式解析出对应的 ant 模型定义，找不到返回 `undefined`。
export function resolveAntModel(
  model: string | undefined,
): AntModel | undefined {
  if (process.env.USER_TYPE !== 'ant') {
    return undefined
  }
  if (model === undefined) {
    return undefined
  }
  const lower = model.toLowerCase()
  return getAntModels().find(
    m => m.alias === model || lower.includes(m.model.toLowerCase()),
  )
}
