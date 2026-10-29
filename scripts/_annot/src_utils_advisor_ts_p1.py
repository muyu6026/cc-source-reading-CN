# 数据文件：src/utils/advisor.ts
SOURCE_PATH = 'src/utils/advisor.ts'

ANNOTATIONS = [
    (6, 'after', '''本模块定义 advisor 工具的类型与功能门控：advisor 由更强评审模型支撑，是否启用由 GrowthBook 特性值、环境变量与仅首方 beta 头共同决定。'''),
    (14, 'after', '''AdvisorServerToolUseBlock：advisor 的服务端工具调用块（type 为 server_tool_use、name 为 advisor）。'''),
    (32, 'after', '''AdvisorToolResultBlock：advisor 返回块，可能是正常结果、加密后的隐藏结果或错误，三者择一。'''),
    (44, 'after', '''isAdvisorBlock：类型谓词，判定某块是否为 advisor 的工具调用或结果块。'''),
    (69, 'after', '''isAdvisorEnabled：综合环境变量禁用开关、仅首方 beta 资格与特性标志，决定是否启用 advisor。'''),
    (85, 'after', '''getExperimentAdvisorModels：在启用且用户不可配置时返回基础模型与 advisor 模型配对，否则 undefined。'''),
    (96, 'after', '''modelSupportsAdvisor：判断主循环模型是否支持调用 advisor（opus-4-6 / sonnet-4-6 或内部 ant 用户）。'''),
    (106, 'after', '''isValidAdvisorModel：判断某模型能否作为 advisor 模型，规则与 modelSupportsAdvisor 一致。'''),
    (128, 'after', '''getAdvisorUsage：从用量对象里筛出 advisor_message 类型的迭代，附带模型信息。'''),
    (145, 'after', '''ADVISOR_TOOL_INSTRUCTIONS：注入给模型的 advisor 工具使用说明，指导其在实质性工作前后、卡住或改方案时调用顾问。'''),
]
