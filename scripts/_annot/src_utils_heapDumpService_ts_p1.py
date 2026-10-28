ANNOTATIONS = [
    (25, 'before', """HeapDumpResult：堆转储操作的结果类型，成功时返回堆快照与诊断文件路径，失败时返回错误信息。"""),
    (36, 'before', """MemoryDiagnostics：与堆快照一起采集的内存诊断结构，用于区分泄漏发生在 V8 堆内还是原生内存中。"""),
    (88, 'before', """captureMemoryDiagnostics：采集当前进程的内存诊断快照，包括堆统计、句柄数、文件描述符、泄漏指标与增长速率。"""),
    (136, 'after', """若检测到游离上下文（detached contexts）数量大于零，记录为可能的 iframe 或上下文泄漏。"""),
    (210, 'after', """把当前 CC 版本号写入诊断信息，便于事后对照排查内存问题对应的构建版本。"""),
    (221, 'before', """performHeapDump：核心堆转储函数，先写诊断文件再抓堆快照，因为大堆快照序列化可能崩溃，先落盘诊断可保底。"""),
    (250, 'after', """先以 0o600 权限写入诊断 JSON（成本低、不易失败），再尝试写入堆快照。"""),
    (284, 'before', """writeHeapSnapshot：把堆快照写入文件，Bun 与 Node 走不同实现，用 pipeline 自动处理流清理。"""),
    (285, 'after', """在 Bun 环境下堆快照不支持流式，改用同步写入以避免跨线程克隆大字符串。"""),
    (300, 'after', """Node 环境下用 createWriteStream 配合 pipeline 把 V8 堆快照流式写入目标文件。"""),
]
