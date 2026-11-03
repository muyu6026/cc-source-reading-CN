# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (20, 'after', '''EMPTY_ERRORS_TO_IGNORE 是模块级哨兵：作为默认参数保持引用稳定，
避免每次渲染新建 Set 触发挂载副作用反复执行。'''),
    (169, 'after', '''组件按 currentError 渲染对应处理 UI：needsGitStash→TeleportStash、
needsLogin→登录对话框（或已登录则直接走 OAuth 流程），无错误则返回 null。'''),
    (177, 'after', '''_temp 作为取消回调，直接同步退出进程。'''),
    (188, 'after', '''getTeleportErrors 并发检查『需要登录』与『git 不干净』两类前置错误，汇总成集合返回。'''),
]
