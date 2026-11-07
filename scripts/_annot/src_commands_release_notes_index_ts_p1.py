ANNOTATIONS = [
    (1, 'after', """`Command` 类型来自 `../../commands.js`，仅作形状约束、运行期零成本。"""),
    (3, 'after', """命令对象以 `: Command` 类型注解声明（而非 `satisfies`），字段缺失会编译报错。"""),
    (4, 'after', """`description` 是命令在帮助列表里的单行说明文案。"""),
    (7, 'after', """`supportsNonInteractive` 为 true，表示该命令可被非交互模式（脚本/管道）调用。"""),
    (8, 'after', """`load` 经动态 `import()` 惰性加载实现模块，未用到不进包。"""),
    (11, 'after', """默认导出命令对象，供命令注册表统一收集。"""),
]
