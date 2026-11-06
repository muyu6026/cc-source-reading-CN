# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''claude-api 内置技能的内容装配：把各语言 .md 文档内联为构建期字符串'''),
    (4, 'after', '''各语言 / 主题的 .md 文档通过 Bun 文本加载器内联为字符串'''),
    (17, 'after', '''导入技能主提示词 SKILL.md'''),
    (30, 'after', '''导入最后一个共享文档后，依赖收集完成'''),
    (31, 'after', '''模型发布时更新下方模型 ID / 名称常量（会被替换进 .md 的占位符）'''),
    (36, 'after', '''SKILL_MODEL_VARS：当前 OPUS / SONNET / HAIKU 的 ID 与显示名'''),
    (43, 'after', '''PREV_SONNET_ID：旧 Sonnet ID，用于 SKILL.md 里「不要追加日期后缀」示例'''),
    (47, 'after', '''SKILL_PROMPT：技能主提示词（来自 SKILL.md）'''),
    (49, 'after', '''SKILL_FILES：把所有语言 / 主题文档按相对路径映射到内联字符串'''),
]
