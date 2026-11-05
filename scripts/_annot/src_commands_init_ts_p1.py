ANNOTATIONS = [
    (1, 'before', '''命令入口：引入特性开关、命令类型、项目引导完成标记与环境变量判真工具'''),
    (6, 'before', '''OLD_INIT_PROMPT：旧版 /init 引导提示词——让 Claude 分析代码库生成 CLAUDE.md；整段为模板字符串，内部不批注'''),
    (28, 'before', '''NEW_INIT_PROMPT：新版分阶段提示词（询问 → 探查 → 补全 → 写 CLAUDE.md → 写本地档 → 建技能 / 钩子 → 优化 → 总结）'''),
    (226, 'before', '''command 对象：/init 命令定义，按特性开关与环境变量在新旧提示词间切换'''),
    (239, 'before', '''getPromptForCommand：执行时标记项目引导完成，并按开关返回对应提示词'''),
    (254, 'after', '''以 satisfies Command 收尾，确保对象符合命令类型约束'''),
]
