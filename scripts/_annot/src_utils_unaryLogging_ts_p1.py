ANNOTATIONS = [
    (4, 'after', """模块总述：把单轮补全事件标准化后上报到 `tengu_unary_event`，覆盖接受、拒绝、响应三种事件与四类补全类型。"""),
    (6, 'before', """CompletionType 四类补全事件枚举：单次/多次字符串替换、单文件写入、单次工具调用。"""),
    (12, 'before', """LogEvent 上报载荷形状：补全类型、事件类别，以及含语言名/消息ID/平台/可选反馈的 metadata。"""),
    (23, 'before', """logUnaryEvent：把事件各字段逐一 cast 成遥测元数据类型后交给 `logEvent` 上报，metadata 里语言名可能是 Promise 故先 await。"""),
    (38, 'after', """结束 `logEvent` 调用：最后用条件展开补上可选的 `hasFeedback` 字段，其余必填字段已显式列出。"""),
]
