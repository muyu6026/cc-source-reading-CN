ANNOTATIONS = [
    (1, 'before', '''文件级批注：`addCommand.ts` 注册「mcp add」子命令，支持 stdio、SSE、HTTP 三种传输，处理作用域、环境变量、请求头、OAuth 客户端凭据与 XAA（SEP-990）校验，并把服务器配置写入对应作用域。'''),
    (28, 'after', '''依赖引入：commander 扩展类型、CLI 退出辅助、分析埋点、MCP 认证/配置/工具，以及 XAA 登录与环境变量解析。'''),
    (80, 'after', '''命令定义与选项：注册「add <name> <commandOrUrl> [args...]」，并挂载 scope、transport、env、header、oauth 与 xaa 等选项（XAA 仅在启用时显示）。'''),
    (122, 'after', '''XAA 前置校验：启用「--xaa」时要求 client-id、client-secret 与已配置的 xaaIdp 三者齐备，否则报错。'''),
    (274, 'after', '''stdio 分支：当传输为 stdio 时，把命令、参数、环境变量写入配置，并对疑似 URL 但未显式指定传输的情况给出警告。'''),
    (280, 'after', '''`registerMcpAddCommand` 动作回调：先校验名称与命令、XAA 前置条件，再按 sse、http、stdio 三种传输分别构造配置、写入对应作用域并回显，OAuth 凭据另存。'''),
]
