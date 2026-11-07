ANNOTATIONS = [
    (1, 'after', """`Command` 类型为统一形状契约，仅导入类型、运行期零成本。"""),
    (2, 'after', """引入 `isEnvTruthy`，把环境变量解析为布尔，用于条件开关。"""),
    (4, 'after', """命令用 `export default {` 直接导出对象，并以 `satisfies Command` 收口。"""),
    (8, 'after', """`isEnabled` 经 `DISABLE_LOGOUT_COMMAND` 环境变量决定是否在界面暴露该命令。"""),
    (9, 'after', """`load` 用动态 `import()` 惰性加载实现模块，未调用不进包。"""),
    (10, 'after', """`satisfies Command` 静态校验对象形状，不改动运行时类型。"""),
]
