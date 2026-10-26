# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (9, 'after', '''// 桥接邮箱：把外部 mailbox 的消息在 REPL 非加载态时投递给输入框（onSubmitMessage）。'''),
    (14, 'after', '''// 用 useSyncExternalStore 订阅 mailbox.revision：队列变化才重渲染，避免无意义刷新。'''),
    (18, 'after', '''// 加载中不打扰；否则 poll 取一条消息并投递，通常由邮件/外部指令注入。'''),
]
