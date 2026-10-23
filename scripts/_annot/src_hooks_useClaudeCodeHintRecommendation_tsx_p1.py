# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (24, 'after', '''// 表面化 `<claude-code-hint />` 标签驱动的插件安装提示（React Compiler 产物，_c(11) 记忆化）。'''),
    (26, 'after', '''// 订阅待处理的 hint 快照，任何到达的 hint 都会触发解析。'''),
    (53, 'after', '''// tryResolve 异步解析 hint：成功则标记本会话已展示，
// 仅当快照未被更新的 hint 顶替时才清 pending（防竞态丢提示）。'''),
    (84, 'after', '''// yes → 走 installPluginAndNotify 安装插件，触发来源记为 hint。'''),
    (95, 'after', '''// 安装回调：从市场拉取插件并安装，失败则抛出错误（由上层通知捕获）。'''),
    (98, 'after', '''// disable → 永久关闭 hint 推荐，用户不再收到任何插件提示。'''),
    (104, 'after', '''// no → 什么都不装，仅清理当前推荐（保留后续其他 hint）。'''),
    (114, 'after', '''// 返回 recommendation 与统一的处理入口 handleResponse。'''),
]
