# -*- coding: utf-8 -*-
"""src/commands/plugin/PluginErrors.tsx 批注数据（第 165 批）。"""

ANNOTATIONS = [
    (1, 'before', '''「PluginErrors」把插件系统的错误类型翻译成人类可读的中文消息与处置建议，是插件安装/加载失败时的统一出口'''),
    (2, 'before', '''两个导出函数：formatErrorMessage 纯渲染字符串，getErrorGuidance 给下一步建议，二者都只认 PluginError 联合类型'''),
    (3, 'before', '''用穷尽式 switch 覆盖每种错误类型；漏掉一种，TypeScript 会在下面的 never 兜底处直接编译失败'''),
    (4, 'before', '''路径类错误先拼组件名与缺失路径，是后面所有 case 的样板'''),
    (12, 'before', '''清单（manifest）相关错误成组出现：解析失败、校验失败、MCPB 解包失败，三类都指向文件本身有问题'''),
    (24, 'before', '''重复 MCP 服务器被压制：同一命令或 URL 已在别处配置，这里要把被谁抢先说清楚，避免用户以为配置丢了'''),
    (39, 'before', '''企业策略拦截：用 blockedByBlocklist 区分被显式拉黑与不在白名单，两种话术不同'''),
    (53, 'before', '''缓存未命中：提示跑 /plugins 刷新，而不是报错终止'''),
    (58, 'before', '''穷尽守卫：never 类型兜底，保证新增错误类型时这里编译失败，逼你补上对应的 case'''),
    (61, 'before', '''第二个导出：返回下一步该怎么做，可能返回空（某些错误没有建议）'''),
    (80, 'before', '''与第 24 行呼应：重复服务器的处置建议要指回赢了去重的那个插件，因为插件提供的服务器用户没法从自己的配置里删'''),
    (119, 'before', '''没有建议的错误（generic / marketplace-load-failed）返回空，界面上就不显示引导'''),
]
