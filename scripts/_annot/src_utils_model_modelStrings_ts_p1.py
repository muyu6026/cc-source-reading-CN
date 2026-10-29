# 数据文件：src/utils/model/modelStrings.ts
SOURCE_PATH = 'src/utils/model/modelStrings.ts'
ANNOTATIONS = [
    (15, 'after', """文件入口：把模型键解析为各提供商特定的模型 ID 字符串。"""),
    (21, 'after', """ModelStrings：模型键到提供商特定模型 ID 的映射类型。"""),
    (31, 'after', """getBuiltinModelStrings：遍历所有模型键，取对应提供商的 ID。"""),
    (55, 'after', """getBedrockModelStrings：用 Bedrock 推理配置文件解析实际模型 ID，失败回退内置。"""),
    (76, 'after', """applyModelOverrides：把 settings 的 modelOverrides 叠加到内置字符串。"""),
    (100, 'after', """resolveOverriddenModel：把提供商特定 ID 反向解析为权威 first-party ID。"""),
    (116, 'after', """updateBedrockModelStrings：sequential 包裹，确保只初始化一次。"""),
    (134, 'after', """initModelStrings：非 Bedrock 同步初始化，Bedrock 后台拉取。"""),
    (145, 'after', """getModelStrings：返回叠加 overrides 的模型字符串，Bedrock 走兜底默认。"""),
    (166, 'after', """ensureModelStringsInitialized：确保完全初始化，Bedrock 等待推理配置拉取完成。"""),
]
