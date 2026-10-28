ANNOTATIONS = [
    (36, 'after', """ENABLED：模块级开关，读取 CLAUDE_CODE_PROFILE_QUERY 环境变量决定是否开启查询性能剖析。"""),
    (50, 'before', """startQueryProfile：开始一次查询剖析会话，清空上次的标记与内存快照并递增查询计数。"""),
    (69, 'before', """queryCheckpoint：在指定名称处打点并记录当时的内存占用，首个分块到达时单独记录首 token 时间。"""),
    (89, 'before', """endQueryProfile：结束当前剖析会话，补打一个 query_profile_end 标记。"""),
    (98, 'before', """getSlowWarning：根据相邻打点的时间差给出慢操作告警，超过 100 毫秒或 1000 毫秒分别提示 SLOW 与 VERY SLOW。"""),
    (129, 'before', """getQueryProfileReport：汇总所有打点生成可读的分阶段耗时报告，包含相对时间与内存快照。"""),
    (152, 'after', """逐个遍历打点，计算相对起始时间与相邻时间差，并格式化到时间线报告中。"""),
    (216, 'before', """getPhaseSummary：按预定义的主要阶段（上下文加载、压缩、工具 schema 等）统计各阶段耗时并以条形图展示。"""),
    (277, 'after', """用方块字符绘制耗时条，每 10 毫秒一个方块，最多 50 个方块，直观反映阶段占比。"""),
    (298, 'before', """logQueryProfileReport：在调试输出中打印查询性能剖析报告，未开启时直接返回。"""),
]
