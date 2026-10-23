# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (19, 'after', '''// 把对话消息记录到 transcript（按会话 ID 归档，仅新会话开始才变）。'''),
    (25, 'after', '''// 增量游标：消息在压缩间只追加，记录上次写到的长度，
// 只把新尾部传给 recordTranscript，避免每次 setMessages 都 O(n) 重扫。'''),
    (29, 'after', '''// 首条 uuid 变化 = 压缩或 /clear 重建了数组；仅靠长度无法区分
// （压缩后 [CB,摘要,...保留,新] 可能更长），故用首 uuid 辅助检测。'''),
    (32, 'after', '''// callSeq 守卫：防止滞后的异步 .then() 覆盖更新的同步更新
// （增量渲染先于压缩 .then() 落定时）。'''),
    (47, 'after', '''// isIncremental：首 uuid 不变且长度增长 → 纯追加，直接切尾部。'''),
    (57, 'after', '''// isSameHeadShrink：首 uuid 不变但长度变短 → 墓碑/回退/裁剪/部分压缩，
// 与压缩（首 uuid 变）区分开。'''),
    (68, 'after', '''// 异步记录并取回序列号；seq 不等说明已有更新的 effect 跑过，放弃本次修正。'''),
    (114, 'after', '''// sync-walk 在增量/首渲染/同头收缩三种安全情况下同步更新 parent hint，
// 必须与 recordTranscript 落盘逻辑严格一致（含 REPL 剥离与 isVirtual 提升），否则 hint 指向未落盘消息。'''),
]
