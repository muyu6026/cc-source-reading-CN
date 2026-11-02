# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件集中解析各类缓存目录路径（错误日志、消息日志、MCP 日志等），并对项目目录与服务器名做路径消毒，保证跨升级版本时缓存目录名稳定。'''),
    (8, 'before', '''此处使用本地 sanitizePath（djb2 哈希），刻意不复用 sessionStoragePortable 中的共享版本（后者在可用时改用 Bun.hash / wyhash）。缓存目录名必须在升级间保持稳定的原因：已有缓存数据（错误日志、MCP 日志）不应被遗弃。'''),
    (13, 'before', '''sanitizePath：把任意名称中非字母数字的字符替换成连字符；若仍超长，则截断后追加名称的 djb2 哈希（36 进制）以保证唯一性。'''),
    (25, 'before', '''CACHE_PATHS：以惰性函数形式暴露各缓存子目录路径。baseLogs 按当前工作目录定位；mcpLogs 额外对服务器名消毒（Windows 下冒号是保留字符）。'''),
]
