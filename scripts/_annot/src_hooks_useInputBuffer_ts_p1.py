# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (31, 'after', '''// buffer 保存历史输入快照，currentIndex 指向当前所处的快照位置（支持撤销）。'''),
    (60, 'after', '''// debounce 快速连续变更：未超过 debounceMs 的输入合并到下一次定时器，
// 不立即入栈，降低高频打字时的缓冲抖动。'''),
    (87, 'after', '''// 入栈前：若不在末尾则截断未来（撤销后再输入即新分支）、
// 与末条相同则跳过、超出上限则只保留最近 maxBufferSize 条。'''),
    (93, 'after', '''// 更新 currentIndex 指向新条目；不在末尾时顺延 +1，否则追加到 buffer 长度处。'''),
    (112, 'after', '''// undo 回退到上一条快照（currentIndex-1），返回该条目供上层还原输入。'''),
    (124, 'after', '''// canUndo：至少有 2 条且不在首条时才允许撤销。'''),
]
