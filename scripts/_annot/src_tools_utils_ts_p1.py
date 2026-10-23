ANNOTATIONS = [
    (6, 'after', r'''只引类型不引值——编译期全部擦除，这个文件在 bundle 里只剩两个函数体。'''),
    (15, 'after', r'''tagMessagesWithToolUseID：给用户消息盖上 sourceToolUseID 标签，让它们在工具 resolving 前保持「瞬时」状态，UI 里的「运行中」占位不会重复渲染。'''),
    (18, 'after', r'''toolUseID 为空（非工具上下文）时原样返回——不打无标签的标。'''),
    (24, 'after', r'''map 只处理 type === 'user'：attachment 和 system 消息不参与打标签，原样透传。'''),
    (33, 'after', r'''getToolUseIDFromParentMessage：从父助手消息里按工具名反查 tool_use 块，拿它的 id。'''),
    (39, 'after', r'''双重窄化：先判存在再判 type==='tool_use'，TS 才肯让取 .id——窄化失败返回 undefined，调用方自行兜底。'''),
]
