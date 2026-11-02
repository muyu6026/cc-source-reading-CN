# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件包裹 Node 的 child_process.execSync，加入慢操作日志埋点。同步 exec 会阻塞事件循环，已标记为 deprecated，建议优先使用异步替代方案。'''),
    (19, 'before', '''execSync_DEPRECATED：带多重重载签名的同步执行封装。重载区分返回 Buffer 还是 string，便于调用方按需声明编码。'''),
    (38, 'after', '''实现体用 `slowLogging` 模板标签记录慢操作，再转发给底层的 nodeExecSync。命令内容仅取前 100 字符用于日志，避免把整条命令（可能含密钥）写入日志。'''),
]
