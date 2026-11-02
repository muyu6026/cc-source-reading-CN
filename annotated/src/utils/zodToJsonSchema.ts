// 文件级批注：`zodToJsonSchema.ts` 用 Zod v4 原生 `toJSONSchema` 把 schema 转成 JSON Schema，并基于引用身份做缓存以扛住高频调用。
/**
 * Converts Zod v4 schemas to JSON Schema using native toJSONSchema.
 */

import { toJSONSchema, type ZodTypeAny } from 'zod/v4'

// 导出类型别名：把 JSON Schema 第七版对象统一成可读的 `Record` 类型。
export type JsonSchema7Type = Record<string, unknown>

// toolToAPISchema() runs this for every tool on every API request (~60-250
// times/turn). Tool schemas are wrapped with lazySchema() which guarantees the
// same ZodTypeAny reference per session, so we can cache by identity.
// 按引用缓存：用 `WeakMap` 以 Zod schema 实例本身为键，命中即复用转换结果。
const cache = new WeakMap<ZodTypeAny, JsonSchema7Type>()

/**
 * Converts a Zod v4 schema to JSON Schema format.
 */
// 转换入口：先查缓存，未命中才真正转换并写回缓存。
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema7Type {
  const hit = cache.get(schema)
  if (hit) return hit
  const result = toJSONSchema(schema) as JsonSchema7Type
  cache.set(schema, result)
  return result
}
// 收尾：缓存命中时直接返回旧结果，避免每次 API 请求重复序列化。
