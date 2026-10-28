ANNOTATIONS = [
    (30, 'after', """SAFE_BRIDGE_STRING_KEYS：允许转发给分析系统的字符串键白名单，像 error_message 这类可能含页面内容的键被排除。"""),
    (36, 'after', """PERMISSION_MODES：浏览器扩展侧支持的权限模式常量集合，用于校验运行时传入的模式值。"""),
    (42, 'before', """isPermissionMode：类型守卫，判断原始字符串是否为合法的权限模式。"""),
    (51, 'before', """getChromeBridgeUrl：根据环境变量与特性开关解析 Chrome 桥接地址，ant 用户或开启开关时走桥接，否则回退原生消息。"""),
    (74, 'before', """isLocalBridge：判断当前是否使用本地桥接（本地 OAuth 或本地桥接环境变量）。"""),
    (85, 'before', """createChromeContext：构建 ClaudeForChrome 上下文，供子进程 MCP 服务端与进程内客户端共用。"""),
    (110, 'after', """onAuthenticationError：鉴权失败时提示用户用同一 claude.ai 账号登录浏览器扩展。"""),
    (218, 'after', """trackEvent：把事件转发给分析系统，仅放行白名单字符串键并把 status 改名为 bridge_status 以避开保留字段。"""),
    (248, 'before', """runClaudeInChromeMcpServer：启动 ClaudeInChrome 的 MCP 服务端，父进程退出时先冲刷分析数据再退出。"""),
    (277, 'before', """DebugLogger：把 MCP 服务端的日志级别映射到本地调试日志输出。"""),
]
