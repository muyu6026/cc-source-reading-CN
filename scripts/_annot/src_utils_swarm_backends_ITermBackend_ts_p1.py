# -*- coding: utf-8 -*-
# src/utils/swarm/backends/ITermBackend.ts（371 行）批注数据
ANNOTATIONS = [
    (9, 'after', '''`teammateSessionIds` 追踪已创建队友分屏的会话 ID。'''),

    (12, 'after', '''`firstPaneUsed` 标记首个分屏是否已经用过。'''),

    (15, 'after', '''`paneCreationLock` 用 Promise 链实现创建锁，防止并行生成队友时分屏竞态。'''),

    (31, 'after', '''`acquirePaneCreationLock` 获取锁并确保顺序执行，返回释放函数。'''),

    (40, 'after', '''`runIt2` 封装 it2 CLI 调用，返回标准输出、错误与退出码。'''),

    (56, 'after', '''`parseSplitOutput` 从 split 命令输出里解析出新分屏的 session ID。'''),

    (73, 'after', '''`getLeaderSessionId` 从环境变量 `ITERM_SESSION_ID` 取出领导者的 session ID。'''),

    (79, 'after', '''`ITermBackend` 用 it2 CLI 管理 iTerm2 原生分屏，实现 `PaneBackend` 接口。'''),

    (99, 'after', '''`isAvailable` 检查是否运行在 iTerm2 且 it2 命令行可用。'''),

    (108, 'after', '''`isRunningInside` 判断是否运行在 iTerm2 内部。'''),

    (123, 'after', '''布局策略：首个队友从领导者竖向分屏，其后者从上一队友横向堆叠，并带死会话剪枝重试。'''),

    (137, 'after', '''无限循环持续尝试分屏，直到成功或抛错。'''),

    (177, 'after', '''执行 it2 的 split 命令拿到新分屏。'''),

    (208, 'after', '''目标若仍存活或无法判断，不破坏状态，直接抛出错误。'''),

    (235, 'after', '''解析分屏结果，返回新分屏的 `paneId` 与是否首个分屏。'''),

    (240, 'after', '''`createTeammatePaneInSwarmView` 结束，统一在 finally 释放锁。'''),

    (264, 'after', '''`sendCommandToPane` 向指定分屏发送命令（自动补换行，并用 `-s` 精确指定目标）。'''),

    (276, 'after', '''`setPaneBorderColor` 为性能考虑为空实现（每次 it2 调用都慢）。'''),

    (289, 'after', '''`setPaneTitle` 同样为空实现。'''),

    (300, 'after', '''`enablePaneBorderStatus` 空实现，iTerm2 标题自动显示在标签页。'''),

    (313, 'after', '''`rebalancePanes` 记录未实现，iTerm2 自动平衡分屏。'''),

    (328, 'after', '''`killPane` 用 `-f` 强制关闭以绕过关闭确认，并清理追踪状态。'''),

    (339, 'after', '''`killPane` 结束，返回关闭是否成功。'''),

    (351, 'after', '''`hidePane` 不支持，返回假。'''),

    (364, 'after', '''`showPane` 不支持，返回假。'''),

    (365, 'after', '''`ITermBackend` 类定义结束。'''),

    (370, 'after', '''模块导入时自注册该后端（用副作用避免循环依赖）。'''),
]
