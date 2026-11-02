ANNOTATIONS = [
    (1, 'after', '''文件级：组合多个 AbortSignal 与可选超时，返回一个合并 signal 与 cleanup；在 Bun 下特意用 setTimeout+clearTimeout 而非 AbortSignal.timeout（后者计时器会被惰性持有约 2.4KB/次直到触发）。'''),
    (15, 'before', '''createCombinedAbortSignal：入参是主 signal、可选 signalB、可选 timeoutMs；任一已 aborted 则直接返回已中止的 signal 与空 cleanup。'''),
    (34, 'after', '''设超时：timeoutMs 给定时启用 setTimeout 调 abortCombined，并 unref 避免阻止进程退出。'''),
    (47, 'after', '''收尾：返回合并后的 signal 与 cleanup（cleanup 会清定时器并移除两个 signal 的 abort 监听）。'''),
]
