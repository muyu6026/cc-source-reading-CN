# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''注册 remember 内置技能：审查并提议升级自动记忆条目'''),
    (2, 'after', '''导入 registerBundledSkill 注册器'''),
    (4, 'after', '''registerRememberSkill：仅对内部用户（USER_TYPE=ant）开放'''),
    (5, 'after', '''非内部用户直接返回，不注册该技能'''),
    (64, 'after', '''调用注册器登记 remember 技能'''),
    (65, 'after', '''技能名 remember'''),
    (66, 'after', '''描述：审查自动记忆并提议升级 / 清理到 CLAUDE.md 等'''),
    (68, 'after', '''whenToUse：用户想审查或整理自动记忆时使用'''),
    (70, 'after', '''userInvocable 允许用户直接调用'''),
    (71, 'after', '''isEnabled 仅当自动记忆功能开启时可见'''),
    (72, 'after', '''getPromptForCommand：把内置提示词作为文本块返回，附加用户上下文'''),
    (75, 'after', '''若用户给了额外参数则拼接到提示词后'''),
]
