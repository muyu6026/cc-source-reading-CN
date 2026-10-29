# -*- coding: utf-8 -*-
slug = 'src_utils_startupProfiler_ts'
ANNOTATIONS = [
    (1, 'after', '''文件总述：启动期性能剖析工具，测量并上报各初始化阶段耗时。两种模式：采样日志（ant 100%、外部 0.5% 上报 Statsig）与详细剖析（CLAUDE_CODE_PROFILE_STARTUP=1 时输出含内存快照的完整报告）。底层用 Node 内置 performance hooks。'''),
    (26, 'after', '''DETAILED_PROFILING：仅在 CLAUDE_CODE_PROFILE_STARTUP=1 时开启详细剖析，模块加载期一次性决定。'''),
    (33, 'after', '''STATSIG 采样：ant 用户 100%、外部用户 0.5%，同样在启动期决定，未采样者不付剖析成本。'''),
    (36, 'after', '''SHOULD_PROFILE：详细模式或采样命中任一为真才做剖析。'''),
    (46, 'after', '''memorySnapshots：按 mark 顺序追加内存快照；不用 Map 按名存，因为有些检查点会触发多次（如加载设置），后者会覆盖前者快照。'''),
    (54, 'after', '''PHASE_DEFINITIONS：各上报阶段对应的起止检查点（import、init、settings、total）。'''),
    (59, 'after', '''模块加载期若需剖析，先打一个 profiler_initialized 检查点。'''),
    (75, 'after', '''profileCheckpoint：打一个 mark；仅详细剖析模式才抓内存快照。'''),
    (119, 'after', '''getReport：把全部检查点拼成可读的详细报告文本（含总耗时）。'''),
    (145, 'after', '''profileReport：上报 Statsig（采样命中时才报），并在详细模式下把报告写入文件与调试日志。'''),
    (149, 'after', '''isDetailedProfilingEnabled：导出详细剖析是否开启。'''),
    (153, 'after', '''getStartupPerfLogPath：报告文件按 session id 命名，放在配置目录的 startup-perf 子目录。'''),
    (194, 'after', '''logStartupPerf：把各阶段时长算成元数据，上报 Statsig 事件 tengu_startup_perf；未采样则直接返回。'''),
]
