// 【模块总览】`types.ts` 用 Zod（v4）定义团队记忆同步 API 的**数据契约** + 各步操作的结果类型。
// 它是 `index.ts` 的「形状说明书」：服务器返回长什么样、各种成功/失败结果带哪些字段，都在这里钉死。
// `lazySchema` 是项目里的惰性 schema 包装——用到才编译，避免启动时就实例化所有 Zod 对象。
/**
 * Team Memory Sync Types
 *
 * Zod schemas and types for the repo-scoped team memory sync API.
 * Based on the backend API contract from anthropic/anthropic#250711.
 */

import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

/**
 * Content portion of team memory data - flat key-value storage.
 * Keys are file paths relative to the team memory directory (e.g. "MEMORY.md", "patterns.md").
 * Values are UTF-8 string content (typically Markdown).
 */
export const TeamMemoryContentSchema = lazySchema(() =>
// 【第 16-24 行】`TeamMemoryContentSchema`：团队记忆的内容部分，就是「相对路径 → 文件内容」
// 的扁平 map（`entries`）。`entryChecksums` 是每 key 的 sha256 校验和（anthropic/anthropic#283027 加的），
// **可选项**——为了向前兼容没部署该字段的老服务器：空 entries 时它就是空 map。这正是 `index.ts` 里
// 「response 缺 entryChecksums 就退化成全量上传」那条逻辑对应的数据结构。
  z.object({
    entries: z.record(z.string(), z.string()),
    // Per-key SHA-256 of entry content (`sha256:<hex>`). Added in
    // anthropic/anthropic#283027. Optional for forward-compat with older
    // server deployments; empty map when entries is empty.
    entryChecksums: z.record(z.string(), z.string()).optional(),
  }),
)

/**
 * Full response from GET /api/claude_code/team_memory
 */
export const TeamMemoryDataSchema = lazySchema(() =>
// 【第 29-38 行】`TeamMemoryDataSchema`：GET 接口的完整响应——`organizationId` / `repo` /
// `version` / `lastModified`（ISO 8601）/ `checksum`（带 `sha256:` 前缀的 SHA256）/ `content`。
// 注意 `content` 复用了上面的 `TeamMemoryContentSchema()`，所以校验时是一个嵌套对象。
  z.object({
    organizationId: z.string(),
    repo: z.string(),
    version: z.number(),
    lastModified: z.string(), // ISO 8601 timestamp
    checksum: z.string(), // SHA256 with 'sha256:' prefix
    content: TeamMemoryContentSchema(),
  }),
)

/**
 * Structured 413 error body from the server (anthropic/anthropic#293258).
 * The server's RequestTooLargeException serializes error_code and the
 * extra_details dict flattened into error.details. We only model the
 * too-many-entries case; entry-too-large is handled via MAX_FILE_SIZE_BYTES
 * pre-check on the client side and would need a separate schema.
 */
export const TeamMemoryTooManyEntriesSchema = lazySchema(() =>
// 【第 47-57 行】`TeamMemoryTooManyEntriesSchema`：服务器**结构化 413** 的响应体模型
// （anthropic/anthropic#293258）。服务器把 `error_code` 和 `extra_details`（摊平成 `error.details`）
// 一起序列化回来。这里只建模「条目太多」这一种情况；「单条太大」由客户端 `MAX_FILE_SIZE_BYTES`
// 预检拦截，不需要单独 schema。回头看 `index.ts` 的 `uploadTeamMemory`——解析出来的 `max_entries`
// 就是靠这个 schema 拿到的，然后缓存进 `SyncState.serverMaxEntries`。
  z.object({
    error: z.object({
      details: z.object({
        error_code: z.literal('team_memory_too_many_entries'),
        max_entries: z.number().int().positive(),
        received_entries: z.number().int().positive(),
      }),
    }),
  }),
)

export type TeamMemoryData = z.infer<ReturnType<typeof TeamMemoryDataSchema>>
// 【第 59 行】`TeamMemoryData` 是上面 schema 的**推断类型**（`z.infer`）——写一次 schema，
// 类型自动派生，避免「改了 schema 忘改类型」的漂移。这是 Zod 的核心卖点：schema 即类型。

/**
 * A file skipped during push because it contains a detected secret.
 * The path is relative to the team memory directory. Only the matched
 * gitleaks rule ID is recorded — never the secret value itself.
 */
export type SkippedSecretFile = {
  path: string
  /** Gitleaks rule ID (e.g., "github-pat", "aws-access-token") */
  ruleId: string
  /** Human-readable label derived from rule ID */
  label: string
}

/**
 * Result from fetching team memory
 */
export type TeamMemorySyncFetchResult = {
  success: boolean
  data?: TeamMemoryData
  isEmpty?: boolean // true if 404 (no data exists)
  notModified?: boolean // true if 304 (ETag matched, no changes)
  checksum?: string // ETag from response header
  error?: string
  skipRetry?: boolean
  errorType?: 'auth' | 'timeout' | 'network' | 'parse' | 'unknown'
  httpStatus?: number
}
// 【第 77-87 行】`TeamMemorySyncFetchResult`：「拉」的结果。几个字段直接对应 `index.ts`
// fetch 逻辑的分支：`isEmpty`（404，没数据）/ `notModified`（304，ETag 命中没变化）/ `checksum`
// （响应头的 ETag）；`errorType` 是 `'auth'|'timeout'|'network'|'parse'|'unknown'` 五选一，
// `skipRetry` 标记「不可逆错误、别白重试」。

/**
 * Lightweight metadata-only probe result (GET ?view=hashes).
 * Contains per-key checksums without entry bodies. Used to refresh
 * serverChecksums cheaply during 412 conflict resolution.
 */
export type TeamMemoryHashesResult = {
  success: boolean
  version?: number
  checksum?: string
  entryChecksums?: Record<string, string>
  error?: string
  errorType?: 'auth' | 'timeout' | 'network' | 'parse' | 'unknown'
  httpStatus?: number
}
// 【第 94-102 行】`TeamMemoryHashesResult`：那个「廉价探针」`?view=hashes` 的结果——
// 只有每 key 的校验和、没有条目正文。它在 412 冲突时用来便宜地刷新 `serverChecksums`
// （见 `index.ts` 的 `fetchTeamMemoryHashes`）。`errorType` 同样是那五个值。

/**
 * Result from uploading team memory with conflict info
 */
export type TeamMemorySyncPushResult = {
  success: boolean
  filesUploaded: number
  checksum?: string
  conflict?: boolean // true if 412 Precondition Failed
  error?: string
  /** Files skipped because they contain detected secrets (PSR M22174). */
  skippedSecrets?: SkippedSecretFile[]
  errorType?:
    | 'auth'
    | 'timeout'
    | 'network'
    | 'conflict'
    | 'unknown'
    | 'no_oauth'
    | 'no_repo'
  httpStatus?: number
}
// 【第 107-124 行】`TeamMemorySyncPushResult`：「推」的结果（带冲突信息）。比 FetchResult
// 多了 `conflict`（412 前提失败）/ `skippedSecrets`（因命中密钥被跳过的文件，PSR M22174）；
// `errorType` 多了 `'conflict'|'no_oauth'|'no_repo'`——前两个是 watcher 用来判断「要不要永久压制的」关键信号。

/**
 * Result from uploading team memory
 */
export type TeamMemorySyncUploadResult = {
  success: boolean
  checksum?: string
  lastModified?: string
  conflict?: boolean // true if 412 Precondition Failed
  error?: string
  errorType?: 'auth' | 'timeout' | 'network' | 'unknown'
  httpStatus?: number
  /**
   * Structured error_code from a parsed 413 body (anthropic/anthropic#293258).
   * Currently only 'team_memory_too_many_entries' is modelled; if the server
   * adds more (entry_too_large, total_bytes_exceeded) they'd extend this
   * union.  Passed straight through to the tengu_team_mem_sync_push event
   * as a Datadog-filterable facet.
   */
  serverErrorCode?: 'team_memory_too_many_entries'
  /**
   * Server-enforced max_entries, populated when serverErrorCode is
   * team_memory_too_many_entries. Lets the caller cache the effective
   * (possibly per-org) limit for subsequent pushes.
   */
  serverMaxEntries?: number
  /**
   * How many entries the rejected push would have produced after merge.
   * Populated alongside serverMaxEntries.
   */
  serverReceivedEntries?: number
}
// 【第 129-156 行】`TeamMemorySyncUploadResult`：单次 PUT 的结果，承载 413 的「服务端学习」数据。
// `serverErrorCode` 目前只建模 `'team_memory_too_many_entries'`（将来加新错误码就扩这个联合类型）；
// `serverMaxEntries` / `serverReceivedEntries` 在这次 PUT 被 413 拒绝时填上，让调用方把
// 「本 org 的有效上限」缓存起来、下次推送先截断到正确数量。它们会原样透传到
// `tengu_team_mem_sync_push` 遥测事件，作为 Datadog 里可按维度过滤的 facet。
