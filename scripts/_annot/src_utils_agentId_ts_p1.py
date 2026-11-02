# 批注数据：src/utils/agentId.ts
ANNOTATIONS = [
    (38, 'after', '''把 agent 名与团队名拼成 agentName@teamName 形式的 ID。'''),
    (46, 'after', '''按 @ 切分解析 agent ID；不含 @ 返回 null。'''),
    (62, 'after', '''生成 {请求类型}-{时间戳}@{agentId} 形式的请求 ID，用于关机、计划审批等。'''),
    (74, 'after', '''解析请求 ID：拆出请求类型、时间戳与 agent ID；格式不符或时间戳非数字返回 null。'''),
    (99, 'after', '''本模块只做确定式 ID 的拼接与拆解，不含网络或状态逻辑。'''),
]
