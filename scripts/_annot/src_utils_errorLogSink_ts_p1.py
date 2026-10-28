# -*- coding: utf-8 -*-
# 批注：src/utils/errorLogSink.ts
ANNOTATIONS = [
    (24, 'after', '按启动日期生成日志文件名用的日期串，模块加载时定一次'),
    (29, 'before', '错误日志路径：缓存放 errors/<日期>.jsonl'),
    (36, 'before', '某 MCP 服务器的日志路径：缓存/MCP 日志/<名称>/<日期>.jsonl'),
    (46, 'before', '基于缓冲写入器封装出「写对象即转 JSONL」的写入器'),
    (62, 'after', '按路径缓存的缓冲写入器，避免重复建连'),
    (85, 'before', '取（或懒建）某路径的 JSONL 写入器，首次建时登记退出清理'),
    (111, 'before', '仅 ant 类型记录：给消息补上时间戳、cwd、用户类型、会话 ID 与版本后写入'),
    (128, 'before', '从 MCP 错误响应里尽量取出可读的服务端消息'),
    (152, 'before', 'logError 的实现：把错误连同 axios 请求的 URL/状态码/服务端消息一并写入调试日志与文件'),
    (179, 'before', 'logMCPError 的实现：写 MCP 错误到调试日志与对应服务器日志文件'),
    (200, 'before', 'logMCPDebug 的实现：写 MCP 调试消息到对应服务器日志文件'),
    (225, 'before', '启动期挂载错误日志后端：注册三类实现与两个路径函数；须在分析后端之前调用；可重复调用（幂等）'),
]
