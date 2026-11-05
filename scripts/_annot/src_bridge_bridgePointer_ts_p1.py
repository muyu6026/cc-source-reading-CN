# -*- coding: utf-8 -*-
# 批注数据：src/bridge/bridgePointer.ts
# 锚点 (行号, pos, 中文)。pos ∈ before/after/after_block。
ANNOTATIONS = [
    (1, 'after', '模块：远程控制会话的崩溃恢复指针。进程异常退出后，下次启动据此判断是否需要恢复会话。'),
    (19, 'after', 'worktree 扇出上限：自然受 `git worktree list` 约束（50 已是很大的数），这里额外限制并行 `stat()` 突发，异常配置下回退到仅当前目录。'),
    (40, 'after', '指针存活时间：4 小时。与后端滚动 `BRIDGE_LAST_POLL_TTL` 语义对齐。'),
    (42, 'before', '指针数据结构：`sessionId`、`environmentId`、来源（独立进程或 REPL）。'),
    (52, 'before', '指针文件路径：放在项目目录下的 `bridge-pointer.json`，与转录 JSONL 同目录，按工作目录隔离。'),
    (62, 'before', '写入指针；也用于刷新 mtime——用相同 ID 重写即可推动陈旧时钟，且是尽力而为，绝不能因写失败而崩溃。'),
    (83, 'before', '读取指针及其年龄（距上次写入的毫秒数），直接操作并处理错误，无存在性预检（遵循 TOCTOU 规则）。'),
    (92, 'after', '先 `stat` 取 mtime 作为陈旧性锚点再读内容：两个系统调用都需要，因为 mtime 本身就是要返回的数据。'),
    (105, 'after', '用 mtime 算出年龄，超过 4 小时即判定陈旧并删除，避免后端已回收环境后仍反复提示。'),
    (129, 'before', '跨 worktree 读取：REPL 桥接可能把指针写到 worktree 路径，本函数扇出到兄弟 worktree 找最新指针，与 `/resume` 语义一致。'),
    (159, 'after', '并行 `stat` 加读取：每个 `readBridgePointer` 对无指针的 worktree 只做一次廉价 ENOENT，少数有指针的才读约 100 字节；`Promise.all` 延迟约等于最慢一次。'),
    (190, 'before', '删除指针；幂等——进程此前已干净关闭时 ENOENT 属预期。'),
    (204, 'before', '容错 JSON 解析：失败返回空，交由上层判陈旧。'),
]
