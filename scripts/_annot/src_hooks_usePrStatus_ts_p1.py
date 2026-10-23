# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (7, 'after', '''// 三个轮询参数：POLL_INTERVAL_MS=60s 间隔；SLOW_GH_THRESHOLD_MS=4s 慢 GH 阈值（单次 fetch 超时即永久禁用本 hook）；IDLE_STOP_MS=60min 空闲即停表。'''),
    (23, 'after', '''// 块注释：PR 评审状态每 60s 轮询，会话活跃时跑；60min 无交互则停表（无残留 timer）；慢 GH（>4s）永久禁用；enabled=false 只是跳过轮询但 hook 仍须无条件挂载（rules-of-hooks）；effect 按上次 fetch 时间排下一次，避免回合边界重复 spawn gh。'''),
    (35, 'after', '''// 签名：isLoading 变化会重启 effect（回合开始/结束）；enabled 默认 true，false 时纯跳过，但 hook 无条件调用以满足规则。'''),
    (58, 'after', '''// 空闲判定：lastInteractionTime 变则刷新 lastActivityTimestamp；否则距上次活动 ≥60min 直接 return 停表（不再排 setTimeout）。'''),
    (87, 'after', '''// fetch 后用 number+reviewState 比较决定是否 setState（避免无变化重渲染）；超 4s 设 disabledRef 永久停；否则排下一次 poll（相对 lastFetchRef，防回合边界重 spawn）。'''),
    (94, 'after', '''// effect 启动：按 lastFetchRef 计算距上次 fetch 的剩余间隔，不足一个间隔则补差，避免 turn 边界重复拉起 gh 进程。'''),
]
