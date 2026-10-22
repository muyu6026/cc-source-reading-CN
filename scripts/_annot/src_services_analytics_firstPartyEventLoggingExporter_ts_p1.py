ANNOTATIONS = [
    (1, 'before', '''【第 1-56 行】`firstPartyEventLoggingExporter.ts` 是 1P 后端的**导出器（Exporter）**，
    实现 OTel 的 `LogRecordExporter` 接口。它和 `firstPartyEventLogger.ts` 的关系是：
    logger 负责「收集 + 触发导出」，本文件负责「**怎么把事件可靠地发到服务器**」。
    注释开头把这套 Exporter 在 BatchLogRecordProcessor 之上的额外韧性列得很全：
    追加式失败日志、二次方退避、成功后立刻重试排队事件、大批次分片、401 时退化为无 auth 重试。'''),

    (37, 'after', '''【第 37-46 行】`BATCH_UUID` 是**本进程运行**的唯一 ID，`getStorageDir()` 返回
    `~/.claude/telemetry`。这两个配合实现「**跨进程重启的失败事件恢复**」：
    失败事件按 `1p_failed_events.<sessionId>.<BATCH_UUID>.json` 存盘，
    文件名里带 BATCH_UUID，所以**重启后只重试上一 session、不会误吞别人或自己当前批**（见第 220 行）。
    路径在运行时才求值（第 43 行注释），是为了尊重测试里的 `CLAUDE_CONFIG_DIR` 覆盖。'''),

    (73, 'after', '''【第 73-139 行】构造函数里一堆 `?? / ||` 默认值，值得留意几个：
    - `baseUrl`（第 114-118 行）：默认生产 `api.anthropic.com`，**仅当** ANTHROPIC_BASE_URL 显式是
      staging 时才用 staging；可被动态配置覆盖
    - `maxAttempts ?? 8`：最多重试 8 次后丢弃（第 128 行）
    - `schedule`（第 130 行）：注入式定时器，默认 `setTimeout`，**可注入是为了测试时摆脱真实时钟**
    构造末尾第 138 行 `void this.retryPreviousBatches()` 在后台重试上一 session 的失败文件——
    这是「启动时静默续传」，用户完全无感。'''),

    (146, 'after', '''【第 146-216 行】一组存储 helper，全部走 JSONL（每行一个事件）。
    - `saveEventsToFile`（第 171 行）：空了就删文件、非空就整文件重写（不是追加）
    - `appendEventsToFile`（第 194 行）：**追加**，注释说「在大多数文件系统上是原子的」——
      因为并发写同一个失败文件时，append 不会把两条记录交错
    → 设计上把「整批重写」和「增量追加」两个语义分开，避免互相干扰。'''),

    (218, 'after', '''【第 220-275 行】`retryPreviousBatches`（启动）和 `retryFileInBackground`（单文件）：
    启动时扫 storage 目录里「本 session、但 BATCH_UUID 不是当前」的 `.json` 文件（排除当前批），
    逐个后台重试。第 243-245 行：单文件重试次数也受 `maxAttempts` 限制，超限直接删文件丢弃——
    「重试」和「丢弃」的边界是**次数**，不是「永远试」。第 266-273 行：重试后只把**失败的那部分**
    写回磁盘，不重写原始全部，省一次 IO。'''),

    (277, 'after', '''【第 277-304 行】`export()` 是 OTel 调的入口。它把每次导出都 push 进 `pendingExports` 数组，
    再用 `.finally` 在完成后从数组里移除（第 298-303 行）。这个数组给 `forceFlush()` 用——
    shutdown 时要等所有在途导出结束。`isShutdown` 后直接返回 FAILED（第 281-292 行），
    防止进程退出最后阶段还在往已关闭的通道写。'''),

    (306, 'after', '''【第 306-377 行】`doExport` 是真正的导出逻辑，几道闸门：
    - 第 312 行按 `instrumentationScope.name` 过滤，只处理本模块自己的事件（隔离客户遥测）
    - 第 330 行 `attempts >= maxAttempts` 直接 FAILED 丢弃
    - 第 341 行发送，第 342 行 `attempts++`（**无论成败都 +1**，因为一次导出尝试就是一次）
    - 失败时（第 344 行）排队到磁盘 + 调度退避重试；成功时（第 360 行）reset 退避并**立刻**重试排队事件
    → 这套「成功即清退避、立即排空」让 endpoint 一旦恢复就能快速追上积压。'''),

    (379, 'after', '''【第 379-428 行】`sendEventsInBatches` 把事件按 `maxBatchSize` 切片，逐批发送。
    关键策略在第 394-416 行：**第一批一失败，就假设 endpoint 挂了，剩下的批全部 short-circuit**
    （不再 POST，直接归入 failedEvents），退避定时器下一 tick 再用单批探测。
    这避免了「endpoint 已挂、还逐个重试后面 N 个批」的浪费。`lastErrorContext` 被记下来带进结果，
    方便日志里看到是哪种失败（第 423-425 行）。'''),

    (430, 'after', '''【第 430-443 行】`queueFailedEvents` 用**追加**方式把失败事件写盘（第 436 行 appendEventsToFile），
    注释再次强调「append-only，原子」。然后把上下文拼进报错 message 调 `logError`——
    失败事件被排队这件事本身也要被记录，否则就真的静默消失了。'''),

    (445, 'after', '''【第 445-467 行】`scheduleBackoffRetry` 用**二次方退避**（第 451-455 行）：
    `delay = min(base * attempts², max)`，注释说「匹配 Statsig SDK」—— 这是和成熟 SDK 对齐的刻意选择，
    不是自己拍的。三个早退条件（已退避中 / 已 shutdown / 已被取消）防止重复调度。
    注入式 `schedule`（构造时传入）让定时器可测试。'''),

    (469, 'after', '''【第 469-517 行】`retryFailedEvents` 是一个**排空循环**：只要没 shutdown、文件里还有事件，就反复读盘→发→删文件→发。
    第 491 行「**先删文件再重试**」（事件已在内存里了）—— 这很关键：如果先发再删，发到一半进程崩了，
    文件还在，下次会重复发；而先删再发，崩了就丢这批（可接受，因为终会重试耗尽）。
    第 504-508 行：失败就写回磁盘 + 调度退避 + return（等下一轮），成功就 reset 退避继续循环排空。'''),

    (527, 'after', '''【第 527-615 行】`sendBatchWithRetry` 是最底层的一次 POST，几个要点：
    - 第 530-536 行：如果 `isKilled()` 为 true，**直接 throw**—— 让上层 short-circuit 剩余批并全部落盘，
      被杀期间**零网络流量**；退避定时器继续走，GrowthBook 缓存一旦清掉 flag，下一 tick 自动恢复
    - 第 547-568 行：**信任未建立时跳过 auth**（避免信任弹窗前就执行 apiKeyHelper），
      OAuth token 过期或缺少 `user:profile` scope（service key 会话）时也跳过，退化为无 auth 发送
    - 第 594-611 行：**401 时重试不带 auth**（带 auth 反而被拒时，裸发一次兜底）'''),

    (635, 'after', '''【第 635-762 行】`transformLogsToEvents` 把 OTel 的 `ReadableLogRecord` 翻成 1P 的事件格式。
    第 643-669 行先判是不是 GrowthBook 实验事件（走另一条 `GrowthbookExperimentEvent.toJSON`）。
    普通事件在第 708 行调 `to1PEventFormat`（见 `metadata.ts`）翻成 snake_case，再在第 719-725 行处理 `_PROTO_*`：
    **先把已知的 3 个 PII 字段（skill_name / plugin_name / marketplace_name）hoist 到顶层 proto 字段，
    再防御性 strip 任何剩余的 `_PROTO_*`**—— 这样万一将来服务器加了个没识别的 `_PROTO_foo`，
    也不会悄悄落进通用访问的 `additional_metadata` blob。第 714-718 行注释明确说这是和 `sink.ts` 对称的另一半。
    第 692-703 行：`core_metadata` 缺失时退化为发一个「partial event」（带 `transform_error`），
    而不是整条丢—— 遥测的容错哲学是「能发多少发多少」。'''),

    (764, 'after', '''【第 764-778 行】`shutdown` / `forceFlush`：`shutdown` 先置 `isShutdown`、reset 退避，再 `forceFlush`
    （等所有 `pendingExports` 结束）。`forceFlush` 用 `Promise.all` 等齐在途导出——
    这是进程退出前「发干净最后一波」的保证，和 `firstPartyEventLogger.ts` 末尾的 graceful shutdown 串起来。'''),

    (781, 'after', '''【第 781-806 行】`getAxiosErrorContext` 把 axios 错误翻成一段紧凑的上下文字符串：
    优先取响应头里的 `request-id`（对接服务端日志用），再拼 `status` / `code` / `message`。
    这个字符串会随失败事件一起落盘、进日志，让「为什么这批事件没发出去」事后可查——
    失败路径上的可观测性，和成功路径同样重要。'''),
]
