# 批注数据：src/utils/permissions/getNextPermissionMode.ts
ANNOTATIONS = [
    (17, 'after', '''判断当前会话能否循环切到 auto 模式：同时看启动期缓存的可用标志与实时的网关开关，二者任一失效就记录调试日志。'''),
    (34, 'after', '''Shift+Tab 循环切换权限模式的核心函数：按当前模式映射到下一档。'''),
    (41, 'after', '''蚂蚁（ant）账号特殊处理：跳过接受编辑与计划两档，直接由 bypass 或 auto 取代 default。'''),
    (75, 'after', '''default 分支覆盖 auto 及任何未来模式，一律回退 default。'''),
    (88, 'after', '''高层封装：算出下一模式并执行模式切换的上下文清理（例如进入 auto 时剥离危险权限）。'''),
]
