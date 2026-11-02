ANNOTATIONS = [
    (1, 'before', '''文件级批注：`logger.ts` 实现 OpenTelemetry 的 `DiagLogger` 接口，把第三方遥测诊断日志桥接到本项目的 `logError`/`logForDebugging`。'''),
    (4, 'before', '''类定义：error/warn 时转发到本地日志，info/debug/verbose 为空实现（静默丢弃）。'''),
    (26, 'after', '''类收尾：整个诊断日志器仅关心 error/warn 级别，其余级别不产出任何日志。'''),
]
