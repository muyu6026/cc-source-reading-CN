# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''内置技能注册中心：启动时统一初始化所有随 CLI 分发的技能'''),
    (2, 'after', '''导入 feature（Bun 构建期特性开关）'''),
    (24, 'after', '''initBundledSkills：依次注册各内置技能'''),
    (25, 'after', '''注册 updateConfig / keybindings / verify / debug 等基础技能'''),
    (31, 'after', '''注册 remember / simplify / batch / stuck'''),
    (35, 'after', '''KAIROS 特性开启时按需 require 并注册 dream 技能'''),
    (41, 'after', '''REVIEW_ARTIFACT 特性开启时注册 hunter 技能'''),
    (47, 'after', '''AGENT_TRIGGERS 开启时注册 loop 技能（isEnabled 委托给 cron 开关）'''),
    (56, 'after', '''AGENT_TRIGGERS_REMOTE 开启时注册 scheduleRemoteAgents'''),
    (64, 'after', '''BUILDING_CLAUDE_APPS 开启时注册 claudeApi 技能'''),
    (70, 'after', '''命中 Chrome 自动启用条件时注册 claudeInChrome 技能'''),
    (73, 'after', '''RUN_SKILL_GENERATOR 开启时注册 runSkillGenerator'''),
]
