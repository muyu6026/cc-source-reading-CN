# 会话文件访问埋点：拦截 Read/Grep/Glob/Edit/Write，统计对会话记忆、transcript、memdir、团队记忆的访问
ANNOTATIONS = [
    (49, 'before', '''从工具入参里抽文件路径，覆盖 Read/Edit/Write 三种工具各自的 schema'''),
    (75, 'before', '''根据工具与入参判断这次访问的是会话记忆还是会话 transcript'''),
    (123, 'before', '''对外判断：这次工具调用算不算「记忆文件访问」（会话记忆、memdir 或团队记忆）'''),
    (146, 'before', '''PostToolUse 回调：按文件类型打不同的埋点事件'''),
    (161, 'after', '''命中会话记忆就记 session_memory_accessed，命中 transcript 就记 transcript_accessed'''),
    (168, 'after', '''抽到文件路径后，针对 memdir 访问按读/改/写分别记一个事件'''),
    (210, 'after', '''开启 MEMORY_SHAPE_TELEMETRY 时，对 Edit/Write 记一次记忆文件形状'''),
    (233, 'before', '''把上面这个回调注册到 Read/Grep/Glob/Edit/Write 的 PostToolUse 钩子上'''),
]
