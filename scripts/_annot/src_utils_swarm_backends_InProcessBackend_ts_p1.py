ANNOTATIONS = [
    (23, 'after', '''进程内队友执行后端：实现 TeammateExecutor，使队友与 leader 同进程运行，靠 AsyncLocalStorage 做上下文隔离。'''),
    (39, 'after', '''InProcessBackend：与面板式（tmux/iTerm2）后端不同，进程内队友共享 API 客户端与 MCP 连接，用 AbortController 终止。'''),
    (143, 'after', '''spawn：校验上下文后生成队友并启动其执行循环，剥离父会话消息以免长期占用。'''),
    (180, 'after', '''sendMessage：解析 agentId 取得名称与团队，写入文件信箱完成队友间通信。'''),
    (253, 'after', '''terminate：向队友信箱发关闭请求并置位关闭标志，由队友自身流程决定退出或继续。'''),
    (290, 'after', '''kill：直接调用 AbortController 取消队友全部异步操作，并把任务状态标记为 killed。'''),
    (330, 'after', '''isActive：队友存在、状态为运行中且 AbortController 未中止时才视为活跃。'''),
    (339, 'after', '''createInProcessBackend：工厂函数，供注册表取得后端实例。'''),
]
