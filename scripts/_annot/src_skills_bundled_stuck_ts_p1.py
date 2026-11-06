# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''注册 stuck 内置技能：诊断本机卡死 / 变慢的 Claude Code 会话'''),
    (2, 'after', '''导入 registerBundledSkill 注册器'''),
    (5, 'after', '''提示词含 ps 命令是作为给 Claude 的指令，并非本文件执行'''),
    (61, 'after', '''registerStuckSkill：仅内部用户可用'''),
    (62, 'after', '''非内部用户不注册'''),
    (66, 'after', '''登记 stuck 技能（含描述与提示词构造）'''),
    (67, 'after', '''描述：诊断卡死会话并报告到 #claude-code-feedback'''),
    (70, 'after', '''userInvocable 允许直接调用'''),
    (71, 'after', '''getPromptForCommand：返回内置诊断提示词，附用户上下文'''),
    (72, 'after', '''把内置 STUCK_PROMPT 作为文本块返回'''),
    (77, 'after', '''若用户给了额外参数则拼接到提示词后'''),
]
