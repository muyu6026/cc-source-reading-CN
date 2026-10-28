# 批注数据：source/src/utils/settings/validation.ts（第 66 批）
# 锚点：行号, 位置(before/after/after_block), 中文批注（自带「注：」前缀，禁止 " 与 \）
ANNOTATIONS = [
    (1, 'before', """注：本文件把设置文件的 Zod 校验错误翻译成人类可读的提示：识别各类 Zod v4 问题、构造字段路径、给出修复建议与文档链接，并能在整文件校验前先过滤掉非法权限规则。"""),
    (15, 'before', """注：isInvalidTypeIssue 等四个小函数是 Zod v4 各类 issue 的类型守卫，用于在后续分支里安全读取 expected/values/keys/minimum 等字段。"""),
    (45, 'before', """注：FieldPath 用点号路径表示字段位置（如 permissions.defaultMode），ValidationError 是一条校验错误的完整结构。"""),
    (48, 'before', """注：ValidationError 含文件路径、字段路径、可读消息、期望值、非法值、修复建议、文档链接，以及 MCP 专属的作用域与严重度元数据。"""),
    (85, 'before', """注：getReceivedType 把未知值归约成类型名（null/undefined/array/typeof 结果），用于错误文案里说明「实际收到什么」。"""),
    (97, 'before', """注：formatZodError 把 ZodError 的每条 issue 映射成 ValidationError，按类型拼出「期望 X 但收到 Y」「未识别字段」「数值不得小于 N」等可读消息。"""),
    (179, 'before', """注：validateSettingsFileContent 在编辑设置时做整文件校验：先解析 JSON，再用严格模式对照 SettingsSchema，成功返回 isValid，失败给出错误与完整 schema 供参考。"""),
    (224, 'before', """注：filterInvalidPermissionRules 在 schema 校验前先剔除非法权限规则（非字符串或不符合语法的），逐条给出告警而不让单条坏规则拖垮整份文件。"""),
]
