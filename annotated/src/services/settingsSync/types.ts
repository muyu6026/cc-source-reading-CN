/**
 * Settings Sync Types
 *
 * Zod schemas and types for the user settings sync API.
 * Based on the backend API contract from anthropic/anthropic#218817.
 */

import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

// types.ts 只放同步 API 的 Zod schema 与结果类型，与后端合同 anthropic/anthropic#218817 一一对应。schema 全部用 lazySchema 包一层——zod/v4 的 schema 编译有成本，懒加载保证 import 本模块不触发编译。
/**
 * Content portion of user sync data - flat key-value storage.
 * Keys are opaque strings (typically file paths).
 * Values are UTF-8 string content (JSON, Markdown, etc).
 */
export const UserSyncContentSchema = lazySchema(() =>
  z.object({
    entries: z.record(z.string(), z.string()),
  }),
)
// UserSyncContentSchema：同步内容就是一张扁平 key-value 表。key 是不透明字符串（通常是文件路径，如 ~/.claude/settings.json），value 是 UTF-8 文本（JSON、Markdown 都行）——同步层不解析内容，只当字符串搬运， settings 和 CLAUDE.md 用同一套通道。

/**
 * Full response from GET /api/claude_code/user_settings
 */
export const UserSyncDataSchema = lazySchema(() =>
  z.object({
    userId: z.string(),
    version: z.number(),
    lastModified: z.string(), // ISO 8601 timestamp
    checksum: z.string(), // MD5 hash
    content: UserSyncContentSchema(),
  }),
)
// UserSyncDataSchema：一次 GET 响应的全貌——userId、version（单调递增的版本号）、lastModified（ISO 8601 时间戳）、checksum（MD5，服务端对内容算的摘要）、content。version + checksum 是差量同步与冲突判断的基础。

export type UserSyncData = z.infer<ReturnType<typeof UserSyncDataSchema>>

/**
 * Result from fetching user settings
 */
export type SettingsSyncFetchResult = {
  success: boolean
  data?: UserSyncData
  isEmpty?: boolean // true if 404 (no data exists)
  error?: string
  skipRetry?: boolean
}
// SettingsSyncFetchResult：拉取结果三态——success 且带 data（有数据）、success 且 isEmpty（404，远端还没有）、success: false 带 error。skipRetry 是给上层的硬提示：认证类失败别再重试。isEmpty 单列一个字段而不是复用 data: null，让「空」和「失败」在类型层面就分开。

/**
 * Result from uploading user settings
 */
export type SettingsSyncUploadResult = {
  success: boolean
  checksum?: string
  lastModified?: string
  error?: string
}
// SettingsSyncUploadResult：上传成功后回传服务端新算的 checksum 与 lastModified，客户端可拿去与本地比对确认落地。

/**
 * Keys used for sync entries
 */
export const SYNC_KEYS = {
  USER_SETTINGS: '~/.claude/settings.json',
  USER_MEMORY: '~/.claude/CLAUDE.md',
  projectSettings: (projectId: string) =>
    `projects/${projectId}/.claude/settings.local.json`,
  projectMemory: (projectId: string) => `projects/${projectId}/CLAUDE.local.md`,
} as const
// SYNC_KEYS 定义同步的四个键：全局用户 settings.json、全局用户 CLAUDE.md，以及两个按 projectId 拼前缀的项目级键（projects/<id>/.claude/settings.local.json、projects/<id>/CLAUDE.local.md）。项目级键带 id 前缀，多个项目的文件可以在同一张表里共存而不串键。
