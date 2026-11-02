# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件用 AsyncLocalStorage 实现「按异步上下文覆盖当前工作目录」，让并发的智能体各自看到自己的 cwd 而不互相污染全局状态。'''),
    (12, 'before', '''runWithCwdOverride：在给定 cwd 下运行 fn，fn 及其所有异步后代调用 pwd() / getCwd() 都会拿到这个覆盖值。'''),
    (19, 'before', '''pwd：优先读取 AsyncLocalStorage 中本上下文的覆盖值，否则回退到全局 cwd 状态。'''),
    (26, 'before', '''getCwd：在 pwd() 之外再加一层兜底——若读取失败则回退到原始启动目录 getOriginalCwd()。'''),
]
