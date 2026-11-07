ANNOTATIONS = [
    (1, 'after', """`Command` 类型是命令的统一形状契约，仅导入类型、运行期零开销。"""),
    (3, 'after', """命令对象以 `satisfies Command` 静态校验形状，运行时类型不变。"""),
    (6, 'after', """`description` 描述命令用途，显示在帮助与命令列表中。"""),
    (7, 'after', """`supportsNonInteractive` 为 false，说明该命令需要交互界面、不能纯脚本驱动。"""),
    (8, 'after', """`load` 用动态 `import()` 惰性加载实现文件，未调用不进主包。"""),
    (11, 'after', """默认导出，供上层命令注册表收集。"""),
]
