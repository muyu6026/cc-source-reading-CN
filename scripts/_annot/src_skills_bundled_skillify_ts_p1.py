# -*- coding: utf-8 -*-
# 批注数据：src/skills/bundled/skillify.ts
# 锚点 (行号, pos, 中文)。pos ∈ before/after/after_block。
ANNOTATIONS = [
    (1, 'after', '模块：内置 skillify 技能——把当前会话中可复用的流程沉淀成一个可复用的技能（SKILL.md）。'),
    (6, 'before', '`extractUserMessages`：从消息列表中抽出用户的文本消息，合并多块文本、丢弃空白。'),
    (22, 'before', '`SKILLIFY_PROMPT`：发给模型的提示词模板，描述四轮访谈流程（分析会话、采访用户、写 SKILL.md、确认保存）。模板内用 `{{占位符}}` 待替换。'),
    (158, 'before', '`registerSkillifySkill`：注册 skillify 技能。'),
    (159, 'after', '仅 ant 用户可用，普通构建不注册。'),
    (179, 'before', '`getPromptForCommand`：拼装提示词——把会话记忆、用户消息、用户描述填进模板占位符。'),
    (190, 'after', '用 `replace` 把三个占位符替换为实际内容，得到最终提示词。'),
    (197, 'after', '注册结束，技能定义返回。'),
]
