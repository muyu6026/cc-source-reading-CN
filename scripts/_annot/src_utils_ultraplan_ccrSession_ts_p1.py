ANNOTATIONS = [
    (19, 'after', '''本文件实现 /ultraplan 的 CCR 会话轮询：等待浏览器里用户批准 ExitPlanMode，再抽取计划文本，复用 RemoteAgentTask 的分页与事件类型。'''),
    (24, 'after', '''轮询常量：3 秒间隔；pollRemoteSessionEvents 不重试，故设最大连续失败次数以免一次网络抖动中断整轮。'''),
    (44, 'after', '''UltraplanPollError：携带失败原因与拒绝计数的自定义错误，区分终止、超时、抽取缺失、网络异常等。'''),
    (48, 'after', '''ULTRAPLAN_TELEPORT_SENTINEL：浏览器在反馈里写入的哨兵串，表示用户选择传回终端执行，计划文本紧随其后。'''),
    (66, 'after', '''UltraplanPhase：运行/待输入/计划就绪三态，由事件流推导；传送或批准都会让轮询结束。'''),
    (181, 'after', '''ExitPlanModeScanner：纯状态分类器，吞入 SDKMessage 批次并返回当前判定，无 I/O、无定时器，便于单测与离线回放。'''),
    (189, 'after', '''PollResult：返回获批计划文本与执行目标（本地传送或远端批准），决定后续是否归档远端会话。'''),
    (306, 'after', '''pollForApprovedExitPlanMode：主轮询循环，按优先级判定批准/传送/终止/待输入，超时按是否见过待定态给出不同错误。'''),
    (316, 'after', '''contentToText：把 tool_result 的内容（字符串或文本块数组）统一转成字符串，兼容 threadstore 不同编码。'''),
    (329, 'after', '''extractTeleportPlan：在哨兵串后截取计划文本；哨兵缺失返回 null，调用方视为普通拒绝。'''),
    (349, 'after', '''extractApprovedPlan：从两种不同标签下截取已批准计划文本，缺失则抛出明确错误便于排查。'''),
]
