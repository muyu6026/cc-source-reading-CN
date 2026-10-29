# 批注数据：src/utils/headlessProfiler.ts

ANNOTATIONS = [
    (1, 'after', '''本文件是无界面（打印）模式下测量每轮延迟的剖析工具：跟踪系统消息、首查询、首响应等时相，
用 Node 内置 performance hooks 计时，采样上报到 Statsig。'''),
    (27, 'after', '''DETALED_PROFILING 由 CLAUDE_CODE_PROFILE_STARTUP 控制是否开启详细日志。'''),
    (34, 'after', '''STATSIG_LOGGING_SAMPLED 决定采样上报：内部用户全量，外部用户按百分之五概率。'''),
    (37, 'after', '''SHOULD_PROFILE 为详细模式或采样命中二者之一即开启剖析。'''),
    (43, 'after', '''currentTurnNumber 跟踪当前轮次，由 startTurn 自增。'''),
    (56, 'after', '''clearHeadlessMarks 清除本模块打的所有 mark，避免与其它剖析标记冲突。'''),
    (77, 'after', '''headlessProfilerStartTurn 在每轮开始时清旧标记、自增轮次并打 turn_start，仅无界面且开启剖析时生效。'''),
    (97, 'after', '''headlessProfilerCheckpoint 在指定名称处打 mark，仅无界面且开启剖析时记录。'''),
    (178, 'after', '''logHeadlessProfilerTurn 在每轮末计算各时相相对 turn_start 的耗时并上报，
仅采样命中时写 Statsig，详细模式下额外打印。'''),
]
