# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useMcpConnectivityStatus.tsx
# MCP 连通性通知：本地失败/claude.ai 失败/待授权 四路分流

ANNOTATIONS = [
    (12, 'before', '''// 默认参数用模块级空数组常量而非字面量 []——
// 保证引用稳定，不触发 useMemo/useEffect 依赖变化。'''),

    (18, 'after', '''// 默认值解构：调用方不传 mcpClients 时用空数组，
// undefined 判定编译进产物（t1 === undefined ? EMPTY : t1）。'''),

    (29, 'before', '''// 四路过滤：本地 MCP 失败 / claude.ai 连接器失败 /
// 本地待授权 / claude.ai 待授权。IDE 类（sse-ide/ws-ide）与
// claudeai-proxy 各走专门判据，不混入本地失败桶。'''),

    (33, 'before', '''// 四路全空直接返回：没有可报告的问题就不碰通知区。'''),

    (77, 'before', '''// claude.ai 类过滤器额外要求 hasClaudeAiMcpEverConnected——
// 从未连通过的服务不报「断开」噪音。'''),
]
