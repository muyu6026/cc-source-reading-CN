# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (18, 'after', '''// 订阅 IDE 经 MCP 发来的 log_event 通知，转成内部 analytics 事件（tengu_ide_<name>）。'''),
    (26, 'after', '''// 从 MCP 客户端列表里挑出 ide client；没有则本 hook 啥也不做。'''),
    (38, 'after', '''// 注册处理器：把 IDE 上报的事件名与数据透传进 logEvent，eventData 用 passthrough 保留任意附加字段。'''),
]
