ANNOTATIONS = [
    (1, 'after', '''文件级：三个 profiler（startup / query / headless）共用的基础设施——同一套 perf_hooks 时间线与同一套详细报告行格式。'''),
    (14, 'before', '''getPerformance：懒加载 perf_hooks.performance（仅在启用 profiling 时），进程级单例，避免无谓引入。'''),
    (22, 'before', '''formatMs：把毫秒格式化为三位小数文本。'''),
    (33, 'before', '''formatTimelineLine：渲染共享报告的一行时间线——「[+总.ms] (+增量.ms) 名称 [额外] [| RSS / Heap]」，totalPad/deltaPad 控制列宽对齐（startup 用 8/7，query 用 10/9）。'''),
    (46, 'after', '''formatTimelineLine 收尾：把内存信息拼成「| RSS: x, Heap: y」（无内存数据时留空）。'''),
]
