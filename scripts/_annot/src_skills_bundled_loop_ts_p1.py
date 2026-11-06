# -*- coding: utf-8 -*-
# 第 167 批：src/skills/bundled/loop.ts 批注数据
ANNOTATIONS = [
    (1, 'after', '''依赖：cron 工具名常量、默认最大龄期、是否启用 Kairos cron 的开关、注册入口。'''),
    (7, 'after', '''注册入口：把本技能挂进内置技能表。'''),
    (9, 'after', '''默认间隔十分钟：没写间隔时回退到这个值。'''),
    (25, 'after', '''buildPrompt：把用户输入拼成一段给模型的指令，教它怎么解析间隔与提示词并调度 cron。'''),
    (72, 'after', '''registerLoopSkill：注册 /loop 技能，描述、触发条件、参数提示都在这里。'''),
    (83, 'after', '''isEnabled 接 Kairos cron 开关：没开就不显示这个技能。'''),
    (90, 'after', '''getPromptForCommand：有参数就生成调度指令，没参数就回用法文案。'''),
    (92, 'after', '''文件收尾：技能注册完成，命令名 loop 即对外入口。'''),
]
