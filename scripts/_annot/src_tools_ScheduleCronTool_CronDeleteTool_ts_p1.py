ANNOTATIONS = [
    (20, 'before', r'''inputSchema 只有一个 id——删除必须精确到任务，不接受按 cron 表达式或 prompt 内容批量删（容易误删）。'''),
    (35, 'before', r'''buildTool 主结构。getPath() 返回 cron 文件路径——框架据此把「删除任务」归类为对该文件的写操作，权限链路可见。'''),
    (61, 'before', r'''validateInput 两道：任务存在（错误码 1）+ 归属正确（错误码 2）。与 CronList 的可见性过滤互为表里——看不见的也删不掉，两层防御同一语义。'''),
    (72, 'after', r'''归属校验：teammate 只能删自己的。没有这道检查，队友猜到/枚举到队长的任务 ID 就能取消全局调度——多代理系统里「资源归属」必须在每个写入口重验，不能只靠列表过滤遮丑。'''),
    (82, 'before', r'''call() 极简：removeCronTasks([id])。所有校验前置，执行层不留判断——这是 validateInput/call 分工的典范形态。'''),
]
