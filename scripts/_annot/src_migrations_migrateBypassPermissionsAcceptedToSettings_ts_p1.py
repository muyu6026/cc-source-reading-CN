# 数据文件：source/src/migrations/migrateBypassPermissionsAcceptedToSettings.ts
ANNOTATIONS = [
    (1, 'after', """迁移：把全局配置里的 bypassPermissionsModeAccepted 搬到 settings.json 的 skipDangerousModePermissionPrompt；settings 才是用户可配置项。"""),
    (14, 'after', """入口：读全局配置，若没设过跳过危险模式提示则写到 settings，并打点、再清掉旧全局字段。"""),
    (15, 'after', """读取全局配置。"""),
    (17, 'after', """没有旧字段就直接返回，幂等。"""),
    (22, 'after', """仅在尚未设置时写入 skipDangerousModePermissionPrompt = true。"""),
    (30, 'after', """用函数式更新删掉旧的 bypassPermissionsModeAccepted 字段。"""),
    (35, 'after', """任何失败都记错误日志，不让迁移中断主流程。"""),
]
