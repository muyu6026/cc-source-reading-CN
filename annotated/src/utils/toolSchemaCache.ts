// 文件级批注：`toolSchemaCache.ts` 维护一个会话级工具 schema 渲染缓存，避免每次渲染都重算约 11K token 的工具块及其下游。
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

// Session-scoped cache of rendered tool schemas. Tool schemas render at server
// position 2 (before system prompt), so any byte-level change busts the entire
// ~11K-token tool block AND everything downstream. GrowthBook gate flips
// (tengu_tool_pear, tengu_fgts), MCP reconnects, or dynamic content in
// tool.prompt() all cause this churn. Memoizing per-session locks the schema
// bytes at first render — mid-session GB refreshes no longer bust the cache.
//
// Lives in a leaf module so auth.ts can clear it without importing api.ts
// (which would create a cycle via plans→settings→file→growthbook→config→
// bridgeEnabled→auth).
// 类型定义：在 `BetaTool` 基础上扩展 `strict` 与 `eager_input_streaming` 两个可选字段。
type CachedSchema = BetaTool & {
  strict?: boolean
  eager_input_streaming?: boolean
}

const TOOL_SCHEMA_CACHE = new Map<string, CachedSchema>()
// 常量定义收尾：模块级单例 `Map`，存「键到缓存 schema」的映射。

export function getToolSchemaCache(): Map<string, CachedSchema> {
  return TOOL_SCHEMA_CACHE
}
// 第一个函数收尾：对外暴露该缓存 `Map`（只读引用，调用方自行增删）。

export function clearToolSchemaCache(): void {
  TOOL_SCHEMA_CACHE.clear()
}
// 第二个函数收尾：清空整个缓存，由 auth.ts 在鉴权态变化时调用，且不触发 api.ts 的循环依赖。
