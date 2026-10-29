# 数据文件：src/utils/activityManager.ts
SOURCE_PATH = 'src/utils/activityManager.ts'
ANNOTATIONS = [
    (1, 'after', """文件入口：通用活动追踪，区分用户活跃时间与 CLI 活跃时间。"""),
    (6, 'after', """ActivityManagerOptions：可注入 getNow 与计数器，便于测试。"""),
    (33, 'after', """构造器：初始化时间函数，每个实例独立记录。"""),
    (40, 'after', """getInstance：单例获取。"""),
    (55, 'after', """createInstance / resetInstance：测试用实例管理与重置。"""),
    (81, 'after', """recordUserActivity：CLI 活跃时跳过用户计时，仅在超时窗口内累计。"""),
    (101, 'after', """startCLIActivity：开始 CLI 计时，首个操作置 CLI 为活跃。"""),
    (125, 'after', """endCLIActivity：结束 CLI 计时并记录区间时间。"""),
    (140, 'after', """trackOperation：自动包裹异步操作的起止计时。"""),
    (160, 'after', """getActivityStates：返回当前活跃状态，主要供测试与调试。"""),
    (164, 'after', """导出单例 activityManager。"""),
]
