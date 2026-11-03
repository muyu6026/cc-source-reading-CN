# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (15, 'after', '''压缩后问卷的触发概率固定为 20%（SURVEY_PROBABILITY）。
只有会话发生过压缩（compaction）之后，才按这个概率弹出反馈问卷。'''),
    (31, 'after', '''hasMessageAfterBoundary 判断压缩边界之后是否还存在真实对话消息：
有 user/assistant 消息才说明这次压缩产生了新上下文，值得追访问卷。'''),
    (75, 'after', '''useSurveyState 提供问卷状态机（state / lastResponse / open / handleSelect），
本组件只负责『何时弹出』与『记录事件』，UI 交互交给它。'''),
    (155, 'after', '''第二个 useEffect 是真正的触发逻辑：
满足未禁用、空闲、有 pending 边界等条件后，按 20% 概率调用 open() 弹出问卷。'''),
    (171, 'after', '''主 hook 返回 {state, lastResponse, handleSelect} 给上层渲染，
其余内部状态（已见边界集合、gate 开关等）都封在闭包里。'''),
    (177, 'after', '''_temp3 判断一条消息是否为压缩边界（isCompactBoundaryMessage）。'''),
    (192, 'after', '''_temp2 在用户作答时记录反馈事件：
同时打 tengu_post_compact_survey_event（Statsig）与 feedback_survey（OTel）两条。'''),
    (205, 'after', '''_temp 在问卷『出现』时记录曝光事件，与作答事件分开统计。'''),
]
