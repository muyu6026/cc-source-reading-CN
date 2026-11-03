# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (18, 'before', '''常量：感谢语隐藏延迟、记忆调查开关名、触发概率等。'''),
    (24, 'before', '''hasMemoryFileRead：扫描消息，判断是否曾读取过自动管理的记忆文件。'''),
    (47, 'before', '''useMemorySurvey：控制「记忆反馈调查」是否弹出的核心钩子。'''),
    (57, 'after_block', '''注释：用 ref 记录已评估过的助手消息，避免重复概率判定。'''),
    (65, 'before', '''onOpen：调查出现时上报 appeared 事件（分析 + OTel）。'''),
    (76, 'before', '''onSelect：用户作答时上报 responded 事件。'''),
    (89, 'before', '''shouldShowTranscriptPrompt：仅在内部环境且作答为 bad/good 时考虑弹出转录分享。'''),
    (116, 'before', '''onTranscriptSelect：处理转录分享选择，记录结果或标记「不再询问」。'''),
    (139, 'before', '''接入共享调查状态机（useSurveyState），注入各回调。'''),
    (153, 'before', '''取最近一条助手消息作为触发判定的依据。'''),
    (154, 'before', '''主副作用：满足多重条件（特性开启、自动记忆、策略允许、命中记忆词）后按概率弹出调查。'''),
    (206, 'before', '''返回调查状态与两个选择回调供组件消费。'''),
]
