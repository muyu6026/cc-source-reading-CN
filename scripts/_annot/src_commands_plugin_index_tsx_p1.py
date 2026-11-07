# 批注数据：source/src/commands/plugin/index.tsx
ANNOTATIONS = [
    (1, 'before', '''本文件定义 `plugin` 命令：管理 Claude Code 插件。
虽是 `.tsx` 但本质仍是命令对象定义，末尾的 source map 被省略不抄。'''),
    (3, 'after', '''`type: 'local-jsx'` 表示命令会弹出本地界面来浏览与操作插件。'''),
    (5, 'after', '''`aliases: ['plugins', 'marketplace']` 给出两个等价别名，覆盖不同叫法习惯。'''),
    (8, 'after', '''`load` 用动态 `import()` 懒加载实现，主程序启动时不加载它。'''),
    (9, 'after', '''`satisfies Command` 在编译期校验对象符合命令接口，运行时类型不变。'''),
]
