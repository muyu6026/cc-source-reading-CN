# 数据文件：src/utils/settings/validationTips.ts
SOURCE_PATH = 'src/utils/settings/validationTips.ts'
ANNOTATIONS = [
    (4, 'after', """文件入口：基于 Zod 校验错误，提供人类可读的修复建议与文档链接。"""),
    (19, 'after', """TipContext：校验错误的上下文，含路径、错误码、期望值等。"""),
    (24, 'after', """TipMatcher：匹配函数与建议的组合。"""),
    (26, 'after', """DOCUMENTATION_BASE：文档站基址。"""),
    (54, 'after', """cleanupPeriodDays 校验提示：设为 0 会彻底关闭会话持久化。"""),
    (87, 'after', """hooks 校验提示，纠正历史上错误的 matcher 对象写法。"""),
    (132, 'after', """TIP_MATCHERS：针对各 settings 字段的匹配规则表。"""),
    (138, 'after', """PATH_DOC_LINKS：按路径前缀补齐文档链接。"""),
    (153, 'after', """枚举校验错误时拼出合法取值列表作为建议。"""),
    (164, 'after', """getValidationTip：查找匹配规则，组合建议与文档链接后返回。"""),
]
