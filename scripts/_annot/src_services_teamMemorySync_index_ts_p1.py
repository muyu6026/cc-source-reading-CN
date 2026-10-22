ANNOTATIONS = [
    (1, 'before', '''【模块总览】`teamMemorySync/index.ts` 实现「团队记忆」的本地文件 ↔ 服务器双向同步。
团队记忆是按 **git remote 哈希**隔离的一堆本地文件，同一个组织（org）里所有登录成员共享。
核心就三件事：
① 三个 HTTP 接口（GET 拉 / GET ?view=hashes 只拉校验和 / PUT 推）；
② 拉取时「服务器优先」（per-key 覆盖本地），推送时「只传差异 + 乐观锁」；
③ 所有可变状态收口在调用方创建的 `SyncState` 对象里，模块本身零可变全局状态。'''),

    (71, 'before', '''【第 71-91 行】四个常量，背后是两个容易踩的坑：
· `MAX_FILE_SIZE_BYTES=250K`：单条 entry 上限，上传前先过滤掉超大文件省带宽；
· `MAX_PUT_BODY_BYTES=200K`：单个 PUT 请求体上限，**比文件上限更紧**。
  为什么更紧？API 网关会在请求到达应用服务器之前，用**非结构化的 HTML 413**
  拒掉 >~256-512KB 的请求——这种网关 413 和「应用层条目数超限」的结构化 413
  只能靠延迟区分（~750ms vs ~2.3s）。所以宁可把批切小，也别撞网关。
· `MAX_RETRIES=3` / `MAX_CONFLICT_RETRIES=2`：普通重试 vs 冲突（412）专用重试，分开计数。'''),

    (95, 'after', '''【第 95-119 行】`SyncState` 把**所有可变状态**收口到一个对象：
`lastKnownChecksum`（ETag，条件请求用）、`serverChecksums`（每 key 的 sha256 校验和，算差异用）、
`serverMaxEntries`（从 413 学来的条目上限）。
关键设计：**没有模块级可变变量**，状态由调用方（watcher）创建后一路传进来——
这样每个测试用例 new 一个 `SyncState` 就能天然隔离，不用 mock 全局。'''),

    (129, 'after', '''【第 129-136 行】`hashContent` 算 `sha256:<hex>`，**前缀和服务器一致**
（anthropic/anthropic#283027 约定）。因为格式相同，本地 hash 和服务器 `entryChecksums`
就能直接用字符串相等比较，不需要解析。注意前缀是写死的 `sha256:` 字符串，不是 base64。'''),

    (138, 'after', '''【第 138-144 行】`isErrnoException` 是一个 **TypeScript 类型守卫**：
返回值类型是 `e is NodeJS.ErrnoException`。好处是调用点（比如 626 行）
不需要写 `as` 强转，TS 看到 `if (isErrnoException(e))` 就会自动把 `e` 收窄成
带 `code` 字段的类型。用 `in` 判断 `'code' in e` 而非 `instanceof` 的字面检查，
是因为有些错误对象形态不完全标准，但只要有 `code` 字符串就够了。'''),

    (148, 'after', '''【第 148-161 行】`isUsingOAuth`：团队记忆同步**强制要求 first-party OAuth**。
三层判断：API provider 必须是 firstParty、base URL 必须是 Anthropic 官方、且 token 要同时拥有
`CLAUDE_AI_INFERENCE_SCOPE` 和 `CLAUDE_AI_PROFILE_SCOPE` 两个 scope。
任何一个不满足 → 直接 `return false`，后面的拉/推都会短路失败（见 pull/push 开头的检查）。'''),

    (163, 'before', '''【第 163-167 行】`getTeamMemorySyncEndpoint` 拼同步接口 URL。
两个细节：① 默认用 OAuth 配置里的 `BASE_API_URL`，但可以用环境变量
`TEAM_MEMORY_SYNC_URL` **整体覆盖**（本地联调服务器时用）；
② repo 名用 `encodeURIComponent` 编码——repo 是 `owner/repo` 形式，斜杠必须编码，否则会被当成路径分隔。'''),

    (169, 'before', '''【第 169-184 行】`getAuthHeaders` 组装请求头：Bearer token + `anthropic-beta`
（OAuth 功能在 beta header 后才会生效）+ `User-Agent`。
注意返回类型带 `error?` 字段：拿不到 token 时不抛异常，而是返回 `{ error: '...' }`，
让调用方决定「这是 skipRetry 的致命错误」还是别的。这种「不抛异常、用返回值表达错误」
的模式贯穿整个文件（fetch/upload 都是返回带 `errorType` 的对象）。'''),

    (188, 'before', '''【第 188-306 行】`fetchTeamMemoryOnce` —— 单次「拉」的核心。
几个非显而易见的点：
· `validateStatus` 把 304 / 404 / 200 都当成「成功」（不抛异常），其余状态码才进 catch；
  这样「服务器没数据（404）」「没变化（304）」都能在 try 里正常返回，不用走异常分支。
· 304 走 `notModified` 分支，直接复用传进来的 etag，ETag 链不断；
· 404 把 `lastKnownChecksum` 清成 null（代表「服务器上根本没有这份数据」）；
· 解析失败（响应格式不对）也标 `skipRetry`，因为再试也不会变好。'''),

    (217, 'after', '''【第 215-217 行】`validateStatus` 是 axios 的「哪些状态码算成功」回调。
默认 axios 只在 2xx 抛错，但这里把 304 / 404 也纳入「不抛错」范围——
因为对这个同步接口而言，304（没改）和 404（没有数据）都是**正常的业务结果**，
不是网络/服务器错误。把业务结果从异常流里捞出来，代码分支才清晰。'''),

    (308, 'after', '''【第 308-385 行】`fetchTeamMemoryHashes` —— 冲突解决时的「廉价探针」。
它只请求 `?view=hashes`，服务器**只回每 key 的校验和 + 元数据，不回条目正文**。
为什么需要它？当推送遇到 412 冲突时，如果先拉全量正文（~300KB）只为知道「哪些 key 变了」，
太浪费；这个接口用极小的响应就能刷新 `serverChecksums`，让下一轮 delta 把队友刚推的内容自然排除。
它依赖 anthropic/anthropic#283027 部署；若服务器不支持，调用方会让本次推送失败、等下次编辑再重试。'''),

    (387, 'before', '''【第 387-410 行】`fetchTeamMemory` —— 给「拉」套一层重试。
循环 `MAX_RETRIES + 1` 次：某次成功、或结果带 `skipRetry`（鉴权/解析失败这类不可逆错误）
就立刻返回，不白等；否则按 `getRetryDelay(attempt)` 退避后重试。
注意 `lastResult!` 这个非空断言：循环至少走一次，所以结束时一定有值。'''),

    (414, 'after', '''【第 414-460 行】`batchDeltaByBytes` —— 把差异按**字节数**贪心装箱成多个 PUT。
两个关键点：
① **先 `Object.keys(delta).sort()` 再装箱**——排序保证每次调用分出的批次完全一致，
  这对「冲突循环在部分提交后重试」时的 ETag 稳定至关重要（不排序，Promise.all 按完成顺序，
  每次截断的子集都不同，delta 会膨胀成近乎全量快照）；
② 单条 entry 超过 `MAX_PUT_BODY_BYTES` 时单独成批（250K 文件 ≈ 一个略超软上限、但低于网关实测阈值的批）。
  每个批都是独立的 upsert PUT——批 N 失败，1..N-1 已经在服务器端提交。'''),

    (462, 'before', '''【第 462-553 行】`uploadTeamMemory` —— 单次「推」。
· 带上 `If-Match: "<checksum>"` 做**乐观锁**：服务器持有旧 etag 时返回 412（冲突），否则 200；
· 412 直接返回 `conflict: true`，把「要不要重试」留给上层 `pushTeamMemory` 决定；
· 413（anthropic/anthropic#293258）是**结构化错误**：`error_code` + `extra_details.max_entries`
  告诉客户端「本 org 的有效条目上限是多少」（这个上限是 per-org GB 可调的，客户端没法写死默认值）。
  把学到的 `serverMaxEntries` 缓存进 `SyncState`，下次推送就会先截断到正确数量。'''),

    (557, 'after', '''【第 557-673 行】`readLocalTeamMemory` —— 把本地目录读成 `key→内容` 的扁平 map。
两个安全/稳定性要点（PSR M22174）：
① **上传前先扫密钥**：每个文件用 gitleaks 规则 `scanForSecrets` 扫一遍，命中就**整文件跳过**
  （绝不离开本机），并把命中信息收进 `skippedSecrets` 让上层警告用户——密钥值本身绝不记录/上报；
② **只在从服务器学到 cap 之后才截断**：条目数上限是 per-org 可调的，没学到之前一律全传，
  让服务器当裁判（它在合并后校验总数、原子拒绝，413 时不写任何东西）。截断前先 `sort()`，
  保证「被截断的总是同一批字母序靠后的 key」，否则 delta 计算会失稳。'''),

    (599, 'after', '''【第 596-615 行】密钥扫描的落地处：在把文件塞进上传 map **之前**就 `scanForSecrets`。
只报告每文件第一个命中（一条密钥足够跳过，也不想多记凭据位置）。
被跳过的文件 `return` 掉、不进 `entries`——所以它在「本地→服务器」方向上**永远不会泄露密钥**，
而「服务器→本地」方向由 `writeRemoteEntriesToLocal` 负责（服务器内容本身可信，但仍校验路径边界）。'''),

    (654, 'after', '''【第 654-671 行】排序后再截断，是 delta 稳定的关键。
`Object.keys(entries).sort()` 之后才 `slice(maxEntries)`：磁盘文件数超过学到的上限时，
**字母序靠后的那些 key 永远同步不出去**（这是已知取舍，注释里也写了「要恢复得用 soft_delete_keys」）。
截断时还会 `logEvent('tengu_team_mem_entries_capped', ...)` 上报，方便产品侧知道有多少用户撞到了上限。'''),

    (675, 'after', '''【第 675-755 行】`writeRemoteEntriesToLocal` —— 把服务器条目写回本地。
几个非显而易见的点：
· 每条 key 先用 `validateTeamMemKey` 校验路径，**防路径穿越**（服务器不能借一个 `../../etc/passwd`
  这样的 key 写坏你机器上的任意文件）；`PathTraversalError` 单独 catch 掉、跳过该条；
· **内容相同就跳过**（先 readFile 比对）：这能保住未改文件的 mtime，不会无谓地让
  `getMemoryFiles` 缓存失效、也不会触发文件变更 watcher 事件；
· 并行写（`Promise.all` + `mkdir(recursive:true)`）：并发 mkdir 同一个父目录是安全的，
  `EEXIST` 被 recursive 模式吞掉。冷启动首次拉取是 watcher 的最长耗时项（50 条时 p99 串行 ~22s，
  改成并行后大幅缩短）。'''),

    (759, 'after', '''【第 759-764 行】`isTeamMemorySyncAvailable` 就是 `isUsingOAuth()` 的薄包装——
把「能不能同步」完全等价于「有没有 first-party OAuth」。UI 层用它来决定要不要显示同步入口。'''),

    (766, 'after', '''【第 766-867 行】`pullTeamMemory` —— 公开「拉」接口。
流程：没 OAuth / 没 git remote → 直接失败返回；否则带 etag（除非 `skipEtagCache`）去 fetch。
`notModified` 直接返回（0 文件写入）；`isEmpty` 会**清空 `serverChecksums`**（否则下次推送
会以为服务器还持有其实已不存在的 key，从而漏传）；正常则刷新 `serverChecksums`、写盘、
若真写了文件就 `clearMemoryFileCaches()` 让记忆缓存失效。'''),

    (869, 'after', '''【第 869-1146 行】`pushTeamMemory` —— 整个同步子系统的**核心**，用乐观锁 + 冲突重试。
关键设计（注释里写得很清楚，这里点出为什么）：
· **delta 只传 hash 不同的 key**：`state.serverChecksums` 里和本地 hash 一致的，不上传；
· **local-wins-on-conflict 是故意的**：推送由「本地刚编辑」触发，这个编辑不能被队友的并发推送静默丢弃；
· **不做内容合并**：同一 key 双方都改了 → 本地覆盖服务器版本，队友改的那版丢失。这是两害取其轻——
  本地用户正 actively 编辑、能手动把队友的改动并回来；而静默丢掉本地刚做的编辑是**不可逆**的工作丢失；
· **冲突循环不重读磁盘**：delta 是拿固定本地内容和「刷新后的 serverChecksums」重算的，
  队友并发推来的内容自然被排除出 delta，本地编辑绝不会被覆盖。'''),

    (968, 'after', '''【第 966-971 行】delta 计算本体：遍历本地 hash，凡是 `serverChecksums` 里没有、
或 hash 不等于本地值的 key，就放进 `delta`。`deltaCount === 0` 是「无东西可传」的快速路径
（刚 pull 完没本地改动、或 412 后队友的推送恰好是我们的超集时就会走到这里）。'''),

    (1053, 'after', '''【第 1047-1059 行】413 学习的落点：如果服务器在 413 里回了有效的 `serverMaxEntries`，
就缓存进 `state.serverMaxEntries` 并打日志。**但本次推送仍然失败**——中途重新截断需要重读本地、
重算 delta，而且即便截断也还得 `soft_delete_keys` 才能真正低于服务器现有条数，所以这里选择直接失败、
等用户/下次编辑再处理。'''),

    (1087, 'after', '''【第 1086-1138 行】412 冲突处理：标记 `sawConflict`，若已达 `MAX_CONFLICT_RETRIES`
就放弃；否则 `conflictRetries++` 后发一次廉价 `fetchTeamMemoryHashes` 探针刷新 `serverChecksums`，
下一轮循环重算 delta（队友刚推的、内容相同的 key 自然被排除）。探针失败也直接失败、交给 watcher 重试。'''),

    (1148, 'after', '''【第 1148-1191 行】`syncTeamMemory` —— 双向同步的总入口：**先 pull 再 push**。
pull 用 `{ skipEtagCache: true }` 做全量拉（确保本地是最新），push 用带 412 重试的 `pushTeamMemory`。
冲突时「服务器优先」（pull 覆盖本地）；但 push 里是「本地优先」。这看似矛盾，其实分工明确：
sync 的 pull 是「合并前的全量获取」，push 是「尊重本地用户刚做的编辑」。'''),

    (1195, 'before', '''【第 1195-1256 行】`logPull` / `logPush` —— 把每次同步结果上报遥测。
注意 `errorType` / `error_code` 都 cast 成那个 `never` 标记类型
`AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`（在 analytics 批注里讲过：
这是「用命名做 lint」逼你确认上报字段里没有代码/路径）。`duration_ms` 用 `Date.now() - startTime` 现算，
记录整次同步耗时。'''),
]
