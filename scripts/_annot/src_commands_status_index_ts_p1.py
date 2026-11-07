# 批注数据：source/src/commands/status/index.ts
ANNOTATIONS = [
    (1, 'before', '''本文件定义 `status` 命令：展示 Claude Code 运行状态。
输出含版本、模型、账号、API 连通性与各工具状态。'''),
    (3, 'after', '''命令对象用对象字面量直接定义，并用 `satisfies Command` 约束形状。'''),
    (6, 'after', '''`description` 跨两行书写，是帮助里出现的完整功能说明，
提示用户这条命令能查到哪些运行信息。'''),
    (8, 'after', '''`immediate: true` 表示命令立即执行并输出，不会进入某个交互模式。'''),
    (9, 'after', '''`load` 用动态 `import()` 按需加载实现，主程序启动时不加载它。'''),
]
