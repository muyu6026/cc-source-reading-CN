# 源文件: src/commands/extra-usage/index.ts
ANNOTATIONS = [
    (6, 'after', '''是否启用「超额用量」命令的总开关。'''),
    (10, 'after', '''核心判定委托给 isOverageProvisioningAllowed；若 DISABLE_EXTRA_USAGE_COMMAND 为真则直接返回 false（环境变量优先）。'''),
    (13, 'after', '''交互式版本命令定义：type 为 local-jsx（会弹出配置界面）。'''),
    (19, 'after', '''满足 Command 类型约束；isEnabled 在非交互会话下返回 false，使其只在交互场景出现。'''),
    (21, 'after', '''非交互版本命令定义：type 为 local，支持管道与脚本调用。'''),
    (31, 'after', '''同样满足 Command；isEnabled 仅当处于非交互会话为真，get isHidden 反向控制可见性，按需懒加载 extra-usage-noninteractive.js。'''),
]
