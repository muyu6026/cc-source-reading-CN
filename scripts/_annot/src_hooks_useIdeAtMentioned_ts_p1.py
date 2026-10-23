# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (16, 'after', '''// 通知方法名常量，MCP 客户端用 method 字段路由通知类型，写死避免拼写漂移。'''),
    (29, 'after', '''// 本文件只做一件事：直接往 IDE 的 MCP client 注册 at_mentioned 通知处理器，\n// 不走 React state，靠 ref 持有当前 client 做闭包守卫（与 useIdeSelection 同套路）。'''),
    (37, 'after', '''// ideClientRef 只存「当前连接上的 IDE client」；下面 handler 里会再用它判旧 client 是否已失效。'''),
    (52, 'after', '''// 闭包守卫：MCP client 列表变化导致 ideClient 被换掉时，旧 client 的回调必须丢弃，\n// 否则会把一个已断开会话的 @ 提及误投到新会话。'''),
    (57, 'after', '''// MCP 协议里行号是 0-based，UI 侧约定 1-based，这里统一 +1 对齐。'''),
    (74, 'after', '''// 不写 cleanup：MCP client 自己管理连接生命周期，hook 卸载时连接未必断。'''),
]
