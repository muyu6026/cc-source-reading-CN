ANNOTATIONS = [
    (1, 'after', """`Command` 类型从 `../../commands.js` 导入，仅作形状约束。"""),
    (3, 'after', """命令对象以 `: Command` 类型注解声明（非 `satisfies`），缺字段即编译失败。"""),
    (6, 'after', """`description` 说明命令用于编辑 Claude 记忆文件。"""),
    (7, 'after', """`load` 用动态 `import()` 惰性加载实现模块。"""),
    (10, 'after', """默认导出命令对象，供注册表收集。"""),
]
