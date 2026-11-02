// 文件级批注：`aliases.ts` 集中管理模型别名与模型族通配别名，前者是用户可输入的短名，后者在允许名单里充当通配符。
export const MODEL_ALIASES = [
  'sonnet',
  'opus',
  'haiku',
  'best',
  'sonnet[1m]',
  'opus[1m]',
  'opusplan',
] as const
// 类型推导：从别名数组取出元素联合类型，保证别名常量与类型同步。
export type ModelAlias = (typeof MODEL_ALIASES)[number]

export function isModelAlias(modelInput: string): modelInput is ModelAlias {
  return MODEL_ALIASES.includes(modelInput as ModelAlias)
}
// 收尾：判断输入字符串是否落在已知别名集合内，用于把短名路由到真实模型。

/**
 * Bare model family aliases that act as wildcards in the availableModels allowlist.
 * When "opus" is in the allowlist, ANY opus model is allowed (opus 4.5, 4.6, etc.).
 * When a specific model ID is in the allowlist, only that exact version is allowed.
 */
// 声明模型族通配别名：仅 `sonnet`/`opus`/`haiku` 三种，用于允许名单里的 wildcard 匹配。
export const MODEL_FAMILY_ALIASES = ['sonnet', 'opus', 'haiku'] as const

export function isModelFamilyAlias(model: string): boolean {
  return (MODEL_FAMILY_ALIASES as readonly string[]).includes(model)
// 收尾：判断给定模型是否命中某模型族，命中即放开该族全部具体版本。
}
