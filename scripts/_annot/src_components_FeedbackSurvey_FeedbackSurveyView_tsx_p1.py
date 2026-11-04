# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (12, 'before', 'RESPONSE_INPUTS：0 到 3 四个按键，映射到 dismissed、bad、fine、good 四种响应。用 const 断言让字面量类型直接从数组推导，映射表与数组由同一类型约束。'),
    (20, 'before', 'isValidResponseInput 类型守卫：收窄后的字符串可以直接索引映射表。导出供 useSurveyState 与防抖输入 hook 共用。'),
    (21, 'before', '默认问题文案标注 optional——按数字即答、按 0 忽略，问卷不抢占输入焦点。'),
    (22, 'before', 'FeedbackSurveyView：纯展示加按键处理。问题行是唯一动态段，选项区全部静态。'),
    (30, 'before', 'message 缺省回退默认文案：调用方可以换成针对上下文的定制问题（如按了不喜欢后的追问）。'),
    (54, 'before', 'useDebouncedDigitInput：数字按键防抖——聊天流里用户可能正在输入包含数字的文本，防抖窗口区分「正在打字」与「想按评分」。输入值与回调经对象打包传入，依赖四值记忆化。'),
    (56, 'before', '五个静态段全部进哨兵槽：圆点图标、三档评分（每档固定宽 10 对齐成列）、0 忽略。问卷不打字、只按键，所以选项是一次性的静态布局。'),
    (99, 'before', '最终容器只依赖 t5（问题行）：message 不变时整棵树复用，防抖状态变化不触发问卷重绘。'),
]
