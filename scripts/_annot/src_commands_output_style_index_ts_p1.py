# 批注数据：src/commands/output-style/index.ts
ANNOTATIONS = [
    (1, 'after', '''`/output-style` 命令的注册入口，现已废弃，统一改用 `/config` 调整输出风格。'''),
    (6, 'after', '''描述直接写明已废弃并指向 `/config`，让旧调用方在帮助里就能看到迁移路径。'''),
    (7, 'after', '''`isHidden: true` 把命令从补全列表里隐藏，但历史脚本仍可显式调用，避免硬删除破坏兼容性。'''),
]
