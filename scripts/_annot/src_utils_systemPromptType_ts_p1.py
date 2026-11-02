# 批注数据：source/src/utils/systemPromptType.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。定义一个「品牌类型」`SystemPrompt`，本质是不可变字符串数组，靠 `__brand` 字段在类型层面和普通 `string[]` 区分开，避免误传。'''),
    (10, 'after', '''交叉类型在此收尾：`readonly string[] & { __brand }`，既保留数组能力又带上编译期身份标记。'''),
    (14, 'after', '''工厂函数：把普通只读数组断言成 `SystemPrompt`，故意不在这里复制数据，保证零成本转换。'''),
]
