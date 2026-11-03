ANNOTATIONS = [
    (1, 'after', '''MCPReconnect 是一个自愈式弹窗：当某个 MCP server 连接断了，它自动尝试重连并实时展示重连中 / 失败原因 / 成功三种状态。'''),
    (14, 'after', '''Props 只要两样：serverName 告诉它重连谁，onComplete 在结束时把结果或错误信息回传。'''),
    (21, 'after', '''组件取出主题、全局状态、重连动作和两枚本地状态（是否重连中、错误信息）。'''),
    (23, 'after', '''useTheme 只取当前解析主题用于上色，不依赖 auto 设置。'''),
    (25, 'after', '''isReconnecting 一开始为 true（进入即开始重连），error 初始为 null。'''),
    (85, 'after', '''useEffect 里定义 attemptReconnect：先从全局状态找到该 server，没找到就报错收尾；找到后调用重连动作，再按返回类型分发已连接 / 需鉴权 / 待定 / 失败 / 禁用等结果。'''),
    (110, 'after', '''重连进行中时，展示 Reconnecting to <server> 加一个转圈 Spinner。'''),
    (163, 'after', '''重连失败时，展示红色叉号加失败文案和具体错误信息（error.message）。'''),
    (165, 'after', '''既不在重连也不在报错时，返回 null 不渲染任何东西。'''),
]
