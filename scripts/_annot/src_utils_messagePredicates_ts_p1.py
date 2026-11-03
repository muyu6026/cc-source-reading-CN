ANNOTATIONS = [
    (1, 'before', '''本文件导出类型守卫 `isHumanTurn`，用于从消息流中区分「真人发言」与「工具结果等系统消息」。'''),
    (7, 'after', '''判别式说明：`tool_result` 与真人消息都带 `type:'user'`，真正的区分在于可选字段 `toolUseResult`；历史上四个 PR 都曾因只看 `type==='user'` 而误判，故此处用 `isMeta` 与 `toolUseResult` 双重排除。'''),
]
