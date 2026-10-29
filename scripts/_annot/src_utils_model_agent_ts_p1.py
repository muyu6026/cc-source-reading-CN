# -*- coding: utf-8 -*-
SOURCE_PATH = 'src/utils/model/agent.ts'
ANNOTATIONS = [
    (11, 'after', '''子代理模型选择：默认 inherit，可选 opus/sonnet/haiku 等别名，复杂逻辑在 getAgentModel 里处理 Bedrock 跨区域前缀继承与档位匹配。'''),
    (13, 'after', '''AGENT_MODEL_OPTIONS 把模型别名加上 inherit 构成可选值集合。'''),
    (19, 'after', '''AgentModelOption 描述 UI 里一个模型选项的 value/label/description。'''),
    (27, 'after', '''getDefaultSubagentModel 固定返回 inherit，让子代理继承父线程模型。'''),
    (42, 'before', '''getAgentModel 计算子代理最终生效的模型串：优先环境变量，其次工具指定模型，再按 inherit/别名解析，并把父模型所在区域的 Bedrock 前缀继承下去。'''),
    (95, 'after', '''getAgentModel 结束。'''),
    (122, 'after', '''aliasMatchesParentTier 判断裸家族别名（opus/sonnet/haiku）是否和父模型同档；命中则子代理直接继承父模型的完整串，避免被降成 3P 默认。'''),
    (129, 'after', '''getAgentModelDisplay 把模型值转成 UI 展示文案，空或 inherit 都显示为「继承自父级」。'''),
    (157, 'after', '''getAgentModelOptions 返回 UI 下拉框的四个标准选项（sonnet/opus/haiku/inherit）及各自说明。'''),
]
