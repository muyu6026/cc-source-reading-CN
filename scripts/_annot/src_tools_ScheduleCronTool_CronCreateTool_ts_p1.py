ANNOTATIONS = [
    (25, 'before', r'''MAX_JOBS = 50：定时任务总量硬顶。超限不报「系统错误」而是让模型自己取消一个——配额是用户可理解的资源，不是故障。'''),
    (27, 'before', r'''inputSchema 三参数：cron（5 段标准表达式，本地时区）、prompt（到点入队的提示词）、recurring（默认真=循环，假=一次性后自动删除）、durable（默认假=仅内存，真=落盘跨重启）。recurring/durable 都走 semanticBoolean——模型写 yes/true/1 都能识别。'''),
    (56, 'before', r'''buildTool 主结构。description/prompt 都按 durableEnabled 动态生成——功能开关翻转时工具文案同步换档，模型看到的永远是当前真实能力。'''),
    (82, 'before', r'''validateInput 四道预检，错误码 1-4：① 表达式语法不合法；② 语法合法但一年内无匹配（如 2 月 30 日）——parseCronExpression 过不了日历关；③ 超过 50 个任务上限；④ teammate 禁用 durable（队友不跨会话持久化，durable 任务重启后 agentId 指向不存在的人，成孤儿）。'''),
    (90, 'after', r'''「一年内无匹配」这道检查专门抓 2 月 30 日这类语法合法、日历非法的表达式——只查语法会漏，只在运行时炸更糟（任务永远不触发且无任何提示）。'''),
    (97, 'after', r'''任务数检查先全量拉列表再比长度——cron 任务是会话级小数据（≤50），全量拉取的成本远小于维护一个计数器。'''),
    (105, 'after', r'''teammate durable 禁令的注释说明了根因：队友生命周期绑定会话，持久化任务在重启后持有悬空 agentId。错误消息直接给出结论，不解释原理——模型不需要懂孤儿任务，只需要知道换 session-only。'''),
    (117, 'before', r'''call() 第一行就是 kill switch 折损：effectiveDurable = durable && isDurableCronEnabled()。开关中途翻转时 schema 保持稳定（模型不会因功能降级吃到校验错误），只在执行时静默降级——「能力可以撤，接口不能变」。'''),
    (120, 'after', r'''effectiveDurable 折损后照常入队，返回的 durable 字段是折损后的真实值——tool_result 不说谎，模型能发现自己请求的持久化没生效。'''),
    (133, 'before', r'''setScheduledTasksEnabled(true) 是让任务在本会话触发的关键一步：useScheduledTasks hook 轮询这个标志，下一 tick 开始监视。注意注释点破的一个错觉——durable: false 时磁盘文件永远不变（check() 直接读会话存储），但启动 tick 循环的仍然是这个 enable 标志，与持久化无关。'''),
    (143, 'before', r'''mapToolResult 按 recurring/durable 组合出四种文案， recurring 必须带 DEFAULT_MAX_AGE_DAYS 天数的过期提醒——「到点会自动消失」要当着用户的面说，否则循环任务某天悄悄停止会被当成故障。'''),
]
