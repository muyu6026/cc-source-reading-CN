# 批注数据：source/src/commands/rename/index.ts
ANNOTATIONS = [
    (1, 'before', '''本文件定义 `rename` 命令：为重命名当前会话。
同样是本地 JSX 命令，默认导出前通过 `satisfies Command` 校验形状。'''),
    (6, 'after', '''`description` 是显示在帮助里的功能说明，给用户一眼看懂命令用途。'''),
    (8, 'after', '''`argumentHint` 提示该命令接受的参数写法，`[name]` 表示可选的会话名称。'''),
    (9, 'after', '''`load` 用动态 `import()` 懒加载命令实现，主包不必预先包含它。'''),
    (10, 'after', '''`satisfies Command` 保证对象结构符合命令接口，且不影响运行时导出类型。'''),
]
