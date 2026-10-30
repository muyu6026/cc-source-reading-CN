# 批注数据：src/utils/warningHandler.ts
# slug: src_utils_warningHandler_ts
ANNOTATIONS = [
    (5, 'after', '''全局警告处理器：拦截 Node 的 warning 事件，对外部用户隐藏警告、把内部警告上报到 Statsig 用于监控，并对告警键做有界计数防止内存膨胀。'''),
    (9, 'after', '''MAX_WARNING_KEYS 与 warningCounts：告警键上限与计数表，超过上限后不再追踪新键（其出现次数在遥测中固定记为 1）。'''),
    (35, 'after', '''isRunningFromBuildDirectory：通过比对进程路径是否含构建目录特征串，同步判断当前是否运行于开发构建。'''),
    (46, 'after', '''isInternalWarning：把警告名与消息拼成字符串，匹配已知内部告警模式（如 AbortSignal 监听器超限）。'''),
    (58, 'after', '''resetWarningHandler：仅供测试，移除已安装的处理器并清空计数与状态。'''),
    (60, 'after', '''initializeWarningHandler 签名：安装全局警告处理器，避免重复安装。'''),
    (75, 'after', '''非开发模式下移除 Node 默认警告处理器，对外部用户屏蔽 stderr 警告输出。'''),
    (119, 'after', '''initializeWarningHandler 收尾：把自定义处理器挂到 process 的 warning 事件上，内部告警上报 Statsig，调试模式另打印到日志。'''),
]
