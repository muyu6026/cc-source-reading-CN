ANNOTATIONS = [
    (1, 'after', """`Command` 类型来自 `../../commands.js`，仅作形状约束。"""),
    (3, 'after', """命令用 `export default {` 直接导出对象，并以 `satisfies Command` 收口。"""),
    (7, 'after', """`availability: ['claude-ai']` 限制该命令仅在 claude-ai 渠道可见与可用。"""),
    (8, 'after', """`load` 经动态 `import()` 惰性加载实现文件。"""),
    (9, 'after', """`satisfies Command` 静态校验对象形状，不改动运行时类型。"""),
]
