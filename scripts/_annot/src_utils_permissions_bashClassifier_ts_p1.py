ANNOTATIONS = [
    (1, 'after', """本文件是对外发布构建的桩实现：命令分类器权限特性仅限 ant 内部使用，对外构建中所有函数都返回安全的空值或禁用状态。"""),
    (3, 'after', """`PROMPT_PREFIX` 是提示规则内容的前缀 `prompt:`，用于区分普通规则与提示类规则。"""),
    (5, 'before', """`ClassifierResult` 描述一次分类结果：是否匹配、匹配描述、置信度（高/中/低）与原因。"""),
    (14, 'before', """`extractPromptDescription` 在对外构建中直接返回 `null`（真实实现仅限 ant 内部）。"""),
    (20, 'before', """`createPromptRuleContent` 把描述包装成带 `prompt:` 前缀的规则内容字符串。"""),
    (24, 'before', """`isClassifierPermissionsEnabled` 在对外构建中恒返回 `false`，即该特性禁用。"""),
    (40, 'before', """`classifyBashCommand` 在对外构建中恒返回「不匹配、高置信度、特性已禁用」的结果。"""),
    (55, 'before', """`generateGenericDescription` 在对外构建中直接返回调用方给出的具体描述（若有），否则 `null`。"""),
]
