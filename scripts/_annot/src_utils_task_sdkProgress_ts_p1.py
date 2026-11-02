# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件提供 emitTaskProgress：统一构造并发出一个 task_progress 类型的 SDK 系统事件，被后台智能体与工作流两类调用方共用。'''),
    (10, 'before', '''emitTaskProgress：接收已计算好的原始字段（任务 id、工具调用 id、描述、起始时间、token 数、工具调用次数等），组装成 SDK 事件后通过 sdkEventQueue 入队。调用方各自从自己的状态结构派生这些原语。'''),
    (36, 'after', '''函数体仅做字段映射与入队，不持有任何状态；duration_ms 由当前时间与传入的 startTime 实时相减得到。'''),
]
