# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''导入菱形符号常量与数组计数工具；本文件生成后台任务页脚的「胶囊标签」'''),
    (2, 'after', '''导入 count 计数辅助'''),
    (3, 'after', '''导入 BackgroundTaskState 任务状态类型'''),
    (10, 'after', '''getPillLabel：依据任务集合类型生成紧凑页脚标签'''),
    (11, 'after', '''n = 任务数；allSameType 判断是否为同一类型'''),
    (14, 'after', '''同类型时按具体类型分别措辞'''),
    (16, 'after', '''local_bash：区分监视器（monitor）与交互 shell'''),
    (29, 'after', '''in_process_teammate：按队伍去重计数'''),
    (37, 'after', '''local_agent：本地智能体计数'''),
    (39, 'after', '''remote_agent：云端会话，按 ultraplan 阶段显示不同菱形'''),
    (43, 'after', '''单个 ultraplan 且处于就绪 / 待输入时给出对应文案'''),
    (53, 'after', '''普通云端会话用空心菱形 + 数量'''),
    (57, 'after', '''local_workflow / monitor_mcp / dream 等类型文案'''),
    (66, 'after', '''类型混杂时退回通用「N 个后台任务」'''),
    (74, 'after', '''pillNeedsCta：仅在单条 ultraplan 且处于待输入 / 就绪时显示「↓ 查看」提示'''),
]
