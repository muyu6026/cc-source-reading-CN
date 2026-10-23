ANNOTATIONS = [
    (7, 'after', r'''acceptEdits 模式自动放行的七个文件系统命令：mkdir/touch/rm/rmdir/mv/cp/sed。与 FileEdit/FileWrite 的自动批准范围对齐。'''),
    (19, 'after', r'''isFilesystemCommand 是类型谓词——把 string 收窄成字面量联合。'''),
    (37, 'after', r'''acceptEdits 模式的放行：decisionReason.type = 'mode'，UI 和日志能追溯「为什么自动放行」。'''),
    (58, 'after', r'''checkPermissionMode 是模式权限的入口，注释明说「设计上可扩展到其他模式」。'''),
    (76, 'after', r'''bypassPermissions 直接 passthrough——该模式在主流程里已全放行，这里不重复决策。'''),
    (84, 'after', r'''dontAsk 同理（不问模式也在主流程处理）。'''),
    (94, 'after', r'''逐子命令检查，任一子命令触发模式行为就返回该结果。'''),
    (111, 'after', r'''getAutoAllowedCommands 给 UI 用的查询接口：当前模式自动放行哪些命令（非 acceptEdits 返回空数组）。'''),
]
