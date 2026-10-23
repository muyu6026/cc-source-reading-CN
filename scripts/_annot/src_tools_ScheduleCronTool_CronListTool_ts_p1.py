ANNOTATIONS = [
    (17, 'before', r'''inputSchema 是空 strictObject——列任务不需要任何参数，所见即全部（在权限范围内）。'''),
    (37, 'before', r'''buildTool 主结构。isConcurrencySafe + isReadOnly 双真：纯读操作，可与其他工具并行。'''),
    (63, 'before', r'''call() 一行核心逻辑：队友只看自己的 cron（按 agentId 过滤），team-lead（无 teammate 上下文）看全部。隔离语义与 SendMessageTool 的 mailbox、CronDelete 的删除权限一致——「谁能看见、谁能动」全链路同一把尺子。'''),
    (65, 'after', r'''过滤在内存里做（全量拉取后 filter）而非查询时下推——cronTasks 存储没有按 agentId 索引，50 条上限下全量过滤是可忽略成本。'''),
    (80, 'before', r'''mapToolResult 每行一个任务：ID — 人类可读周期 — recurring/one-shot — [session-only] — 截断到 80 字符的 prompt。prompt 截断是必须的——循环任务的提示词可能很长，列表视图只做预览。'''),
]
