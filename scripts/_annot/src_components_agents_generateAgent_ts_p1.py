# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (24, 'after', '''GeneratedAgent 描述生成结果的三要素：identifier（标识）、whenToUse（使用时机）、systemPrompt（系统提示词）。'''),
    (97, 'after', '''AGENT_CREATION_SYSTEM_PROMPT 是引导模型产出 agent 配置的完整系统提示词，
覆盖意图抽取、人设设计、指令架构、标识命名与 JSON 输出格式。'''),
    (120, 'after', '''AGENT_MEMORY_INSTRUCTIONS 是记忆能力指令，仅在特性开启时拼接到系统提示词尾部。'''),
    (147, 'after', '''按是否开启自动记忆决定系统提示词是否包含记忆指令。'''),
    (165, 'after', '''调用模型（非流式）生成 agent 配置，关闭思考、不带工具，querySource 标记为 agent_creation。'''),
    (181, 'after', '''解析模型返回的 JSON：优先整体解析，失败则正则抽取首个 {…} 对象再解析。'''),
    (197, 'after', '''校验三字段齐全后记录 tengu_agent_definition_generated 事件并返回生成结果。'''),
]
