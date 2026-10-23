# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (59, 'after', '''// 通过 MCP 通知处理器直接注册 IDE 选区变化监听，
// 不走 React 状态中转，选区变化即回调。'''),
    (83, 'after', '''// IDE client 变化时把 undefined 归一化为 null，
// 让 ref 初值 null 与「没找到 IDE」（undefined）相等，避免每次 MCP 更新都误触发重置。'''),
    (94, 'after', '''// 选中行数 = 末行 - 首行 + 1。'''),
    (99, 'after', '''// 末字符落在行首（character===0）时不计入选中行，
// 避免用户只点了行首的「0 宽」选择多算一行。'''),
    (111, 'after', '''// 向 IDE client 注册 selection_changed 通知处理器。'''),
    (117, 'after', '''// 闭包守卫：回调触发时若 IDE client 已被替换，丢弃这次过期通知，
// 防止把旧 client 的选区写进新 client 的回调。'''),
]
