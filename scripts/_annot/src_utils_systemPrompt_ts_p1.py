# 批注数据：src/utils/systemPrompt.ts
# slug: src_utils_systemPrompt_ts
ANNOTATIONS = [
    (13, 'after', '''有效系统提示词组装：buildEffectiveSystemPrompt 按优先级把覆盖提示、协调器提示、智能体提示、自定义提示与默认提示组合成最终系统提示数组。'''),
    (26, 'after', '''isProactiveActive_SAFE_TO_CALL_ANYWHERE：被动模块访问器，安全读取 proactive 模块是否激活，避免在任意位置调用可能未加载的依赖。'''),
    (55, 'after', '''buildEffectiveSystemPrompt 签名：接收智能体定义、上下文、自定义/默认/追加/覆盖提示，返回组合后的 SystemPrompt。'''),
    (58, 'after', '''覆盖提示优先级最高：一旦设置（如 loop 模式）直接替换所有其他提示。'''),
    (75, 'after', '''协调器模式分支：当启用 COORDINATOR_MODE 且无主线程智能体时，用协调器提示替代默认提示。'''),
    (113, 'after', '''主动模式分支：在主动/吉洛斯模式下，把智能体指令追加到默认提示之后而非替换，与队友模式一致。'''),
    (123, 'after', '''兜底组合：按顺序放入智能体提示、自定义提示或默认提示，始终在末尾追加 appendSystemPrompt（除非设置了覆盖提示）。'''),
]
