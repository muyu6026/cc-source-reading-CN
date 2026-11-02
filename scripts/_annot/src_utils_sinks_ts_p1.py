# source: src/utils/sinks.ts
ANNOTATIONS = [
    (1, 'before', '''挂载错误日志与分析事件两个 sink，并排空挂载之前已经排队的事件；两个 init 都是幂等的，从 setup() 调用，其它绕过 setup 的入口（子命令、守护进程、bridge）会直接调用它。'''),
    (16, 'after', '''initSinks 本体：先 initializeErrorLogSink() 再 initializeAnalyticsSink()，二者都幂等，可重复调用而不重复挂载。'''),
]
