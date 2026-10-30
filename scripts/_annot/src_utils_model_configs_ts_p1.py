ANNOTATIONS = [
    (4, 'after', '''ModelConfig 类型：每个 API 提供方对应一个模型名，构成完整配置形状。'''),
    (7, 'after', '''模型上线标记：新增模型时在此处加常量并核对字符串格式，因模式可能变化。'''),
    (14, 'after', '''CLAUDE_3_7_SONNET_CONFIG 收尾：四个提供方（firstParty/bedrock/vertex/foundry）各自的模型标识。'''),
    (84, 'after', '''末个常量 CLAUDE_SONNET_4_6_CONFIG 收尾：保持 satisfies 校验整体形状一致。'''),
    (99, 'after', '''ALL_MODEL_CONFIGS 收尾：汇总所有模型配置，键为内部短名。'''),
    (101, 'after', '''ModelKey 类型：配置对象的键联合类型。'''),
    (105, 'after', '''CanonicalModelId 类型：所有 firstParty 模型标识的联合类型。'''),
    (110, 'after', '''CANONICAL_MODEL_IDS：运行期模型标识列表，供完整性测试使用。'''),
    (118, 'after', '''CANONICAL_ID_TO_KEY：规范标识到内部短名的映射，用于套用设置里的模型覆盖。'''),
]
