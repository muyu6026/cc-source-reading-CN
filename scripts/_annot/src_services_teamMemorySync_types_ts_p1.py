ANNOTATIONS = [
    (1, 'before', '''【模块总览】`types.ts` 用 Zod（v4）定义团队记忆同步 API 的**数据契约** + 各步操作的结果类型。
它是 `index.ts` 的「形状说明书」：服务器返回长什么样、各种成功/失败结果带哪些字段，都在这里钉死。
`lazySchema` 是项目里的惰性 schema 包装——用到才编译，避免启动时就实例化所有 Zod 对象。'''),

    (16, 'after', '''【第 16-24 行】`TeamMemoryContentSchema`：团队记忆的内容部分，就是「相对路径 → 文件内容」
的扁平 map（`entries`）。`entryChecksums` 是每 key 的 sha256 校验和（anthropic/anthropic#283027 加的），
**可选项**——为了向前兼容没部署该字段的老服务器：空 entries 时它就是空 map。这正是 `index.ts` 里
「response 缺 entryChecksums 就退化成全量上传」那条逻辑对应的数据结构。'''),

    (29, 'after', '''【第 29-38 行】`TeamMemoryDataSchema`：GET 接口的完整响应——`organizationId` / `repo` /
`version` / `lastModified`（ISO 8601）/ `checksum`（带 `sha256:` 前缀的 SHA256）/ `content`。
注意 `content` 复用了上面的 `TeamMemoryContentSchema()`，所以校验时是一个嵌套对象。'''),

    (47, 'after', '''【第 47-57 行】`TeamMemoryTooManyEntriesSchema`：服务器**结构化 413** 的响应体模型
（anthropic/anthropic#293258）。服务器把 `error_code` 和 `extra_details`（摊平成 `error.details`）
一起序列化回来。这里只建模「条目太多」这一种情况；「单条太大」由客户端 `MAX_FILE_SIZE_BYTES`
预检拦截，不需要单独 schema。回头看 `index.ts` 的 `uploadTeamMemory`——解析出来的 `max_entries`
就是靠这个 schema 拿到的，然后缓存进 `SyncState.serverMaxEntries`。'''),

    (59, 'after', '''【第 59 行】`TeamMemoryData` 是上面 schema 的**推断类型**（`z.infer`）——写一次 schema，
类型自动派生，避免「改了 schema 忘改类型」的漂移。这是 Zod 的核心卖点：schema 即类型。'''),

    (87, 'after', '''【第 77-87 行】`TeamMemorySyncFetchResult`：「拉」的结果。几个字段直接对应 `index.ts`
fetch 逻辑的分支：`isEmpty`（404，没数据）/ `notModified`（304，ETag 命中没变化）/ `checksum`
（响应头的 ETag）；`errorType` 是 `'auth'|'timeout'|'network'|'parse'|'unknown'` 五选一，
`skipRetry` 标记「不可逆错误、别白重试」。'''),

    (102, 'after', '''【第 94-102 行】`TeamMemoryHashesResult`：那个「廉价探针」`?view=hashes` 的结果——
只有每 key 的校验和、没有条目正文。它在 412 冲突时用来便宜地刷新 `serverChecksums`
（见 `index.ts` 的 `fetchTeamMemoryHashes`）。`errorType` 同样是那五个值。'''),

    (124, 'after', '''【第 107-124 行】`TeamMemorySyncPushResult`：「推」的结果（带冲突信息）。比 FetchResult
多了 `conflict`（412 前提失败）/ `skippedSecrets`（因命中密钥被跳过的文件，PSR M22174）；
`errorType` 多了 `'conflict'|'no_oauth'|'no_repo'`——前两个是 watcher 用来判断「要不要永久压制的」关键信号。'''),

    (156, 'after', '''【第 129-156 行】`TeamMemorySyncUploadResult`：单次 PUT 的结果，承载 413 的「服务端学习」数据。
`serverErrorCode` 目前只建模 `'team_memory_too_many_entries'`（将来加新错误码就扩这个联合类型）；
`serverMaxEntries` / `serverReceivedEntries` 在这次 PUT 被 413 拒绝时填上，让调用方把
「本 org 的有效上限」缓存起来、下次推送先截断到正确数量。它们会原样透传到
`tengu_team_mem_sync_push` 遥测事件，作为 Datadog 里可按维度过滤的 facet。'''),
]
