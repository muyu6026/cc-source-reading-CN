# -*- coding: utf-8 -*-
# src/utils/log.ts（362 行）批注数据
ANNOTATIONS = [
    (30, 'after', '''`getLogDisplayTitle` 按优先级拼出日志或会话的显示标题，并去除不友好标签。'''),

    (58, 'after', '''标题函数结束，去除显示不友好标签后返回干净标题。'''),

    (60, 'after', '''`dateToFilename` 把日期转成文件名安全格式（冒号与点替换为短横）。'''),

    (62, 'after', '''文件名转换结束。'''),

    (66, 'after', '''`MAX_IN_MEMORY_ERRORS` 内存错误日志上限。'''),

    (77, 'after', '''`addToInMemoryErrorLog` 环形写入，超出上限丢弃最旧一条。'''),

    (88, 'after', '''`ErrorLogSink` 定义错误日志后端的接口契约。'''),

    (95, 'after', '''`QueuedErrorEvent` 描述 sink 挂载前排队的事件类型。'''),

    (99, 'after', '''`errorLogSink` 在应用启动时初始化。'''),

    (109, 'after', '''`attachErrorLogSink` 挂载后端并立即排空队列，确保不丢错误。'''),

    (190, 'after', '''sink 未挂载时把错误暂存到队列。'''),

    (134, 'after', '''挂载函数结束，依次派发排队事件。'''),

    (154, 'after', '''`isHardFailMode` 记忆化判断是否带 `--hard-fail` 参数。'''),

    (156, 'after', '''硬失败模式判断结束。'''),

    (158, 'after', '''`logError` 主入口：向多渠道记录错误用于调试与监控。'''),

    (165, 'after', '''硬失败模式下直接打印堆栈并退出进程。'''),

    (176, 'after', '''云端提供商或关闭错误上报时跳过记录。'''),

    (187, 'after', '''始终写入内存日志，无需任何外部依赖。'''),

    (196, 'after', '''`logError` 结束，自身异常被吞掉以免雪崩。'''),

    (203, 'after', '''`getInMemoryErrors` 返回内存中的错误列表，便于缺陷报告。'''),

    (211, 'after', '''`loadErrorLogs` 读取错误日志列表。'''),

    (223, 'after', '''`getErrorLogByIndex` 按排序后索引取单条日志。'''),

    (231, 'after', '''`loadLogList` 内部函数：读取并处理指定路径下的日志文件。'''),

    (283, 'after', '''列表加载结束，按日期排序并补齐排序下标。'''),

    (298, 'after', '''`parseISOString` 把 ISO 字符串解析为日期对象。'''),

    (312, 'after', '''`logMCPError` 记录 MCP 服务器错误，未挂载则排队。'''),

    (326, 'after', '''`logMCPDebug` 记录 MCP 调试信息，未挂载则排队。'''),

    (343, 'after', '''仅 ant 用户保留最近一次消息引用，用于分享会话序列化。'''),

    (352, 'after', '''`captureAPIRequest` 抓取最近一次 API 请求参数用于缺陷报告。'''),

    (362, 'after', '''`_resetErrorLogForTesting` 仅供测试重置错误日志状态。'''),
]
