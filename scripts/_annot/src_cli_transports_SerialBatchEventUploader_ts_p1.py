# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''SerialBatchEventUploader：串行批量事件上传器，带批处理、指数退避重试与背压。任意时刻最多一个 POST 在飞，失败按配置无限重试或达到连续失败上限后丢弃该批。'''),
    (26, 'after', '''RetryableError：从 config.send() 抛出来让上传器按服务端 Retry-After 等待（如 429）。retryAfterMs 会覆盖本次指数退避，但仍被钳制并加抖动。'''),
    (35, 'after', '''配置类型：maxBatchSize / maxBatchBytes 控制每批大小与字节上限，maxQueueSize 触发背压，baseDelayMs / maxDelayMs / jitterMs 控制退避，maxConsecutiveFailures 控制是否丢弃。'''),
    (64, 'after', '''主类与私有字段：pending 缓冲、draining 标记、closed 标记、背压/睡眠/刷新三类等待者队列、以及丢弃批次计数。'''),
    (84, 'after', '''droppedBatchCount：单调计数被 maxConsecutiveFailures 丢弃的批次数。调用方可在 flush 前后快照对比，检测静默丢弃（flush 即使丢批也正常 resolve）。'''),
    (92, 'after', '''pendingCount：返回待发队列深度；close 之后返回关闭时刻的计数，便于关停诊断在清空后再读。'''),
    (101, 'after', '''enqueue：入队事件。空间足够立即返回，否则阻塞等待 drain 腾出空间；关闭后直接返回不接收。'''),
    (125, 'after', '''flush：阻塞直到所有待发事件发完，用于回合边界与优雅关停；队列空且未在排干时直接 resolve。'''),
    (139, 'after', '''close：丢弃待发事件并停止处理，唤醒所有被阻塞的 enqueue 与 flush 调用方，同时清掉睡眠计时。'''),
    (156, 'after', '''drain 循环：用 this.draining 保证同时只有一个实例在跑。串行发批，失败则退避无限重试，除非达到连续失败上限丢弃该批。'''),
    (213, 'after', '''takeBatch：从 pending 取一批，遵守 maxBatchSize 与 maxBatchBytes（首项必取，后续累计 JSON 字节不超上限）。不可序列化的项（BigInt / 循环引用 / toJSON 抛错）就地丢弃，否则会毒化队列让 flush 永久挂起。'''),
    (235, 'after', '''retryDelay：退避计算。有服务端 Retry-After 时先钳制再叠加抖动（防多会话共享限流时同时重击），否则走指数退避并叠加抖动。'''),
    (255, 'after', '''releaseBackpressure：把背压等待者一次性取出并全部唤醒，然后清空当前列表。'''),
    (261, 'after', '''sleep：可被 close 提前唤醒的延时（sleepResolve 暴露出来，close 时调用它）。'''),
]
