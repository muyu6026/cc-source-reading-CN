ANNOTATIONS = [
    (1, 'after', """`Command` 类型为统一形状契约，仅导入类型、运行期零开销。"""),
    (3, 'after', """命令对象以 `satisfies Command` 静态校验形状。"""),
    (6, 'after', """`description` 说明命令用于列出可用 skills。"""),
    (7, 'after', """`load` 用动态 `import()` 惰性加载实现模块，未调用不进包。"""),
    (10, 'after', """默认导出命令对象，供注册表收集。"""),
]
