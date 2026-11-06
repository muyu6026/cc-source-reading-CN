# 批注数据：source/src/migrations/resetAutoModeOptInForDefaultOffer.ts
# slug: src_migrations_resetAutoModeOptInForDefaultOffer_ts

ANNOTATIONS = [
    (1, 'after', '引入 bun 编译期开关、分析埋点、全局/用户配置、日志与权限状态等依赖。'),
    (11, 'after', '迁移用途说明：一次性清空「已接受旧版两选项 AutoMode 弹窗但默认模式非 auto」用户的 skipAutoPermissionPrompt，让新版「设为默认模式」选项重新浮现。'),
    (25, 'after', '导出的一次性迁移函数；整体包在 TRANSCRIPT_CLASSIFIER 开关内，仅蚂蚁内部构建执行。'),
    (26, 'after', '读取全局配置（~/.claude.json），完成标志存于此而非 settings.json，以便跨设置重置保留。'),
    (28, 'after', '若已完成过该迁移则直接返回，保证幂等。'),
    (29, 'after', '仅当自动模式开启状态为 enabled 时才继续；对 opt-in 用户清空会破坏弹窗可达性。'),
    (31, 'after', '进入修正分支，整体包在 try 中以捕获异常。'),
    (33, 'after', '判定条件：用户层存在「跳过自动权限提示」且默认模式不是 auto。'),
    (37, 'after', '将 skipAutoPermissionPrompt 置为 undefined，使弹窗重新出现。'),
    (40, 'after', '埋点：记录本次迁移事件。'),
    (43, 'after', '写入全局配置，置 hasResetAutoModeOptInForDefaultOffer 完成标志。'),
    (49, 'after', '异常兜底：迁移失败时记录错误日志，不影响主流程。'),
]
