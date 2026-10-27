ANNOTATIONS = [
    (13, 'after', '''MCP elicitation 输入的 schema 校验与格式化提示：把 MCP 原始 schema 转成 Zod 校验器并给出友好的格式占位。'''),
    (19, 'after', '''ValidationResult：校验结果类型，成功带值、失败带错误信息。'''),
    (47, 'after', '''isEnumSchema：判断 schema 是否为单选派枚举（兼容旧 enum 与新 oneOf 两种写法）。'''),
    (88, 'after', '''多选枚举工具：从 items.enum 或 items.anyOf 取取值与展示标签，并按值查单条标签。'''),
    (125, 'after', '''单选枚举工具：同样兼容 oneOf 与 enum，并优先采用 enumNames 作为展示名。'''),
    (223, 'after', '''getZodSchema：把 MCP schema 转成 Zod 校验器，覆盖字符串长度/格式、数字范围、布尔等，不支持则抛错。'''),
    (243, 'after', '''validateElicitationInput：同步校验单个字符串输入，成功解析为基础类型，失败汇总各问题信息。'''),
    (288, 'after', '''getFormatHint：为 email/uri/date/date-time 及数值范围生成示例占位提示。'''),
    (301, 'after', '''isDateTimeSchema：判断 schema 是否为支持自然语言解析的 date 或 date-time 格式。'''),
    (336, 'after', '''validateElicitationInputAsync：同步校验失败且为日期格式时，尝试用 Haiku 做自然语言日期解析再二次校验。'''),
]
