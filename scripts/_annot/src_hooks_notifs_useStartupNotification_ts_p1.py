# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useStartupNotification.ts
# 启动通知基座：一次性计算 + 远程门控 + 同步/异步双模 + 错误路由

ANNOTATIONS = [
    (9, 'after', '''// 计算函数三种返回：null 跳过 / 单条 / 多条。'''),

    (11, 'after', '''// 启动通知基座：挂载时跑一次 compute，把结果送进通知系统。
// 封装了 10+ 个 notifs/ hook 各自手写的远程门控与一次性 ref，
// 支持同步/异步返回，异常统一走 logError。'''),

    (19, 'after', '''// compute 只在首次 effect 执行；返回 null 跳过。'''),

    (25, 'after', '''// computeRef 每轮同步赋值：effect 依赖里没有 compute，
// 调用方传新函数不会导致重跑（ref 始终指向最新版）。'''),

    (31, 'before', '''// Promise.resolve 包装：同步函数也走同一 then 链，
// 统一异步时序（compute 抛错与 reject 同路）。'''),

    (35, 'before', '''// 数组归一化：单条/多条一视同仁。'''),

    (39, 'before', '''// 异常路由 logError，不冒泡到 React 渲染层。'''),
]
