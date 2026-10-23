# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (15, 'after', '''// React Compiler 产物：source 参数（cliArg | localCommand）未被类型化；返回 {resumeSession, isResuming, error, selectedSession, clearError} 五元组。'''),
    (49, 'after', '''// resumeSession 闭包：$[0] 缓存（随 source 变）；logEvent 记 tengu_teleport_resume_session → teleportResumeCodeSession → setTeleportedSessionInfo + 重置 isResuming；catch 把 TeleportOperationError 归一化（isOperationError 区分操作错误与普通错误）。'''),
    (62, 'after', '''// $[2] 缓存 clearError（sentinel 首次初始化），恒返回 setError(null)，用于清除 resume 失败信息。'''),
    (83, 'after', '''// 返回值 memo：依赖 error / isResuming / resumeSession / selectedSession（$[3..6]），任一变则重建对象返回。'''),
]
