# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useLspInitializationNotification.tsx
# LSP 轮询式错误通知：manager 失败 + 各 server error 态，去重靠 Set + 状态回写

ANNOTATIONS = [
    (13, 'after', '''// 轮询 LSP 初始化状态与各 server 健康度，出错时弹通知，同时把错误
// 写进 appState.plugins.errors 供 /doctor 汇总。仅在 ENABLE_LSP_TOOL
// 开启时激活。'''),

    (28, 'after', '''// shouldPoll 初值由环境变量决定（编译期替换为 ENABLE_LSP_TOOL）——
// 没开 LSP 的构建里整个轮询直接停摆。'''),

    (40, 'after', '''// 去重键 = 来源 + 错误文案：同一 server 的同一错误只通知一次，
// 靠 ref 里的 Set 记录，跨渲染存活。'''),

    (64, 'before', '''// plugin:xxx 来源剥离出插件名做展示名，
// 非插件来源原样显示。'''),

    (88, 'before', '''// manager 整体初始化失败：报一次错并永久停止轮询
// （setShouldPoll(false)）——后面每个 server 都不可能好了。'''),

    (113, 'after', '''// useInterval 的条件轮询：shouldPoll 为 false 时传 null 停表。
// pending / not-started 状态安静返回，只等最终态。'''),

    (140, 'before', '''// 环境变量真值判断的工厂函数（编译期内联进 useState 初值）。'''),
]
