import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import type { SettingsJson } from '../../utils/settings/types.js'

/**
 * Schema for the remotely managed settings response.
 * Note: Uses permissive z.record() instead of SettingsSchema to avoid circular dependency.
 * Full validation is performed in index.ts after parsing using SettingsSchema.safeParse().
 */
export const RemoteManagedSettingsResponseSchema = lazySchema(() =>
  z.object({
    uuid: z.string(), // Settings UUID
    checksum: z.string(),
    settings: z.record(z.string(), z.unknown()) as z.ZodType<SettingsJson>,
  }),
)
// 信封 schema 刻意宽松：settings 用 z.record(z.string(), z.unknown()) 而不是 SettingsSchema——
// 为的是不 import settings/types.js 的完整校验链（循环依赖：types.ts 被 index.ts 依赖，
// 而 SettingsSchema 那条链最终绕回设置加载管线）。严格校验推迟到 index.ts 的
// SettingsSchema().safeParse() 做（见那里 322 行的第二层校验）。
// 整个 schema 包在 lazySchema 里，和项目其他 Zod v4 数据契约同一惯用法。

export type RemoteManagedSettingsResponse = z.infer<
  ReturnType<typeof RemoteManagedSettingsResponseSchema>
>
// z.infer<ReturnType<...>> 从 schema 派生响应类型——契约和类型永远同源，不手写第二份。

/**
 * Result of fetching remotely managed settings
 */
export type RemoteManagedSettingsFetchResult = {
  success: boolean
  settings?: SettingsJson | null // null means 304 Not Modified (cache is valid)
  checksum?: string
  error?: string
  skipRetry?: boolean // If true, don't retry on failure (e.g., auth errors)
}
// FetchResult 的两个「魔法值」都写在了注释里，是跨文件契约：
// - settings === null 表示 304 Not Modified（缓存仍有效），区别于「空设置」的 {}；
// - skipRetry === true 表示别重试（auth 类错误），fetchWithRetry 靠它决定退避。
// error 字段只用于 log/debug，不做用户可见文案。
