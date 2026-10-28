# 数据文件：src/utils/messages/mappers.ts
# 锚点：(行号, 'before'|'after'|'after_block', 中文批注)
# 规则：禁止英文双引号「"」与反斜杠「\」；pos 仅限 before/after/after_block；行号以 source/ 读数为准。

ANNOTATIONS = [
    (1, 'before', '''模块总览：消息格式双向映射。
在 SDK 暴露的消息结构（SDKMessage）与 Claude Code 内部消息结构（Message）之间互转，
既要把外部消息灌进内部会话，也要把内部消息序列化回 SDK 供移动端与会话接入层消费。'''),

    (74, 'after', '''内部化方向：把 SDK 消息拍平成内部 Message 数组，区分助手、用户、系统三类，
系统消息里的压缩边界会被单独转换成一条 compact_boundary 系统消息。'''),

    (93, 'after', '''SDK 化方向：把内部 CompactMetadata 转成 SDK 字段，注意字段命名从驼峰改写成下划线风格。'''),

    (113, 'after', '''反向转换：把 SDK 的 compact_metadata 还原成内部 CompactMetadata，与上面那条互逆。'''),

    (181, 'after', '''外部化方向主函数：把内部 Message 数组转回 SDKMessage，
对助手消息做工具输入归一化，对系统消息区分压缩边界与本地命令输出两类特殊子类型。'''),

    (215, 'after', '''本地命令输出（如 /voice、/cost）转成一条助手消息而非专用子类型，
原因是移动端与接入层旧代码不认识该子类型；先去 ANSI 再解包 XML 包裹标签。'''),

    (252, 'after', '''把内部限流信息映射成 SDK 的限流结构体，只透传对下游有用的字段，过滤掉内部专用字段。'''),

    (290, 'after', '''助手消息归一化：把方案内容注入到 ExitPlanModeV2 工具输入里，
因为这个 V2 工具从文件读方案而非从输入读，但 SDK 调用方期望输入里带有 plan 字段。'''),
]
