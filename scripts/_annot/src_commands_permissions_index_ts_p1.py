# 批注数据：source/src/commands/permissions/index.ts
ANNOTATIONS = [
    (1, 'before', '''本文件定义 `permissions` 命令：管理允许与拒绝的工具权限规则。
属于本地 JSX 命令，最后默认导出。'''),
    (4, 'after', '''`type: 'local-jsx'` 表示命令会弹出本地界面来编辑权限规则。'''),
    (6, 'after', '''`aliases: ['allowed-tools']` 提供等价别名，方便老用户沿用旧叫法。'''),
    (7, 'after', '''`description` 说明命令用于维护 allow 与 deny 两类工具权限。'''),
    (8, 'after', '''`load` 用动态 `import()` 按需加载实现，保持主包精简。'''),
]
