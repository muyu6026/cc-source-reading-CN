ANNOTATIONS = [
    (1, 'before', """本文件定义 ant 内部专用（ANT-ONLY）模型的相关类型与读取函数，仅当 `USER_TYPE` 为 `ant` 时才返回真实数据，否则一律回落到空或 `null`。"""),
    (4, 'before', """`AntModel` 描述单个 ant 模型：别名、实际模型名、标签、描述，以及默认思考力度、上下文窗口、最大 token 等可选能力字段。"""),
    (34, 'before', """`getAntModelOverrideConfig` 从特性开关读取 ant 模型覆盖配置；非 ant 用户直接返回 `null`。"""),
    (44, 'before', """`getAntModels` 返回全部 ant 模型列表，非 ant 用户返回空数组。"""),
    (51, 'before', """`resolveAntModel` 按精确别名或包含实际模型名的方式解析出对应的 ant 模型定义，找不到返回 `undefined`。"""),
]
