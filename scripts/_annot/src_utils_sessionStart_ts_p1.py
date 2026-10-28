# source: src/utils/sessionStart.ts
ANNOTATIONS = [
    (18, 'after', '''会话启动钩子的选项：sessionId、agentType、model 可覆盖，forceSyncExecution 强制同步执行。'''),
    (26, 'after', '''旁路通道：存放某个钩子吐出的「初始用户消息」，只被 takeInitialUserMessage 取一次。这样设计是为了不改动主流程 Promise<HookResultMessage[]> 的返回类型。'''),
    (32, 'after', '''取出并清空 pendingInitialUserMessage —— 一次性消费，避免被重复读取。'''),
    (43, 'after', '''会话启动钩子主入口：source 区分启动、恢复、清空、压缩四种触发场景，并带可选覆盖项。'''),
    (49, 'after', '''bare 模式直接跳过所有钩子（连插件钩子的加载都不做），因为 bare 下钩子本就不会运行。'''),
    (127, 'after', '''加载插件钩子失败时按错误类型给出「网络、权限、配置」等针对性提示，但不中断会话启动；仅项目级钩子仍可用。'''),
    (156, 'after', '''逐个收集钩子产物：消息、附加上下文、待监视路径，以及一次性的初始用户消息。'''),
    (172, 'after', '''若钩子提供了附加上下文，就包成一条 hook_additional_context 附件消息追加进去。'''),
    (175, 'after', '''返回本轮会话启动钩子产出的全部消息。'''),
    (180, 'after', '''Setup 钩子入口（init 与 maintenance 两种触发）：逻辑与上面的会话启动钩子几乎一致，但只收集消息与上下文。'''),
    (232, 'after', '''返回 Setup 钩子的全部消息；同样在 bare 模式或插件钩子加载失败时优雅降级。'''),
]
