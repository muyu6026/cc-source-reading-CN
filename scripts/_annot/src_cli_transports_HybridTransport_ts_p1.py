ANNOTATIONS = [
    (1, 'before', '''文件级批注：`HybridTransport.ts` 实现混合传输——读走 WebSocket、写走 HTTP POST。它借助 `SerialBatchEventUploader` 做串行批处理、指数退避与背压，并用 100ms 缓冲聚合高频 `stream_event`。'''),
    (22, 'after', '''常量与超时：定义批刷新间隔、单次 POST 超时与关闭宽限期三个时间参数，控制队列阻塞与优雅退出。'''),
    (108, 'after', '''构造函数：继承 `WebSocketTransport`，配置 uploader（大批量上限、高队列上限避免死锁、指数退避加抖动），并派生 POST URL。'''),
    (133, 'after', '''`write`：`stream_event` 进缓冲延迟发送；其余消息先冲刷缓冲再入队并等待排空，保证顺序。'''),
    (169, 'after', '''`writeBatch`、`flush`、`takeStreamEvents` 与 `flushStreamEvents`：批量写入与内部缓冲管理（定时器触发冲刷、排空快照）。'''),
    (195, 'after', '''`close`：同步返回但延后关闭 uploader，用 `Promise.race` 在排空与宽限期之间取先到者，确保残留队列有机会发完。'''),
    (261, 'after', '''`postOnce`：单次 POST 实现。无令牌或 4xx（非 429）为永久失败丢弃；429/5xx 抛错交由 uploader 退避重试。'''),
    (282, 'after', '''`convertWsUrlToPostUrl`：把 `wss://` 会话入口 URL 改写成 `https://` 的 `/session/<id>/events` POST 端点。'''),
]
