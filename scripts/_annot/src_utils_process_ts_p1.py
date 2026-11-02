ANNOTATIONS = [
    (1, 'before', """本文件集中处理进程输出与错误相关的辅助逻辑：包括管道断裂防护、统一写 stdout/stderr、快速失败退出，以及探测 stdin 是否真的有数据。"""),
    (12, 'before', """`registerProcessOutputErrorHandlers` 为 stdout/stderr 注册 `EPIPE` 错误处理器，防止「管道被提前关闭（如 `claude -p | head -1`）」时进程内存泄漏或崩溃。"""),
    (28, 'before', """`writeToStdout` 把数据写入标准输出；底层 `writeOut` 会先判断流是否已销毁，且刻意不处理背压（写返回 `false` 时不等待）。"""),
    (38, 'before', """`exitWithError` 向 stderr 打印错误后立刻以退出码 1 结束进程，合并了入口快路径里常见的「`console.error` + `process.exit(1)`」写法。"""),
    (50, 'before', """`peekForStdinData` 探测一个类 stdin 流是否在 `ms` 毫秒内真的有数据到达：超时返回 `true`，流正常结束返回 `false`。首个数据块会取消超时（之后无条件等待结束），用于区分「真实管道生产者」与「继承但闲置的父进程 stdin」。"""),
]
