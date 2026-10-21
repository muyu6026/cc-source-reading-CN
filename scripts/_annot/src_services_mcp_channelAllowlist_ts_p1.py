# -*- coding: utf-8 -*-
"""src/services/mcp/channelAllowlist.ts 批注数据"""

ANNOTATIONS = [
    (16, 'after', '''// 注释解释了「为什么按 plugin 而不是按 server 授权」，补一句它的代价：
//
// 批准一个 plugin，实际批准的是「这个作者**今后所有版本**」。新版本里多挂一个
// server，那台 server 自动获得「能往对话里推消息」的能力，不需要任何人再点一次。
// 官方把 per-server 说成 overengineering，前提是「被批过的插件已经被审过」——
// 所以这份名单的可信度，就是整个通道功能的可信度上限。'''),
    (37, 'after', '''// safeParse 失败就当空表。这里值得注意方向：GrowthBook 上的值是人手改的 JSON，
// 形状写错不能让 --channels 崩，而「空表」的效果是**全部不通过**。
// 出错时收紧而不是放开，是这类远端配置读取的通用原则。'''),
    (69, 'after', '''// 函数名很像安全判断，但注释明说「Not a security boundary」：
// 它只用于 UI 预筛（要不要显示「启用通道？」），真闸在 gateChannelServer()。
//
// 于是同一套 {marketplace, plugin} 比较在仓库里有两份。改一处的症状是
// 「UI 说可以、点下去被拒」——不会漏防，但会让人不信任 UI。'''),
]
