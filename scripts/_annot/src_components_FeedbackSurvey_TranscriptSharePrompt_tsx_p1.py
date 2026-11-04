# -*- coding: utf-8 -*-
# annotations for src/components/FeedbackSurvey/TranscriptSharePrompt.tsx (88 lines)
ANNOTATIONS = [
    (6, 'before', '会话转录分享询问：yes/no/dont_ask_again 三种响应'),
    (12, 'before', '数字键 1/2/3 映射响应：RESPONSE_INPUTS 常量数组加 inputToResponse 映射表，as const 全程字面量类型'),
    (19, 'after', '类型守卫 isValidResponseInput：includes 判断加 input is ResponseInput 谓词'),
    (20, 'before', '组件本体：静态内容全部哨兵缓存（七段），动态部分只有 useDebouncedDigitInput 的配置对象'),
    (29, 'after', 'onDigit 闭包：把数字转成响应后回调 onSelect'),
    (37, 'after', 'hook 配置对象按依赖缓存：inputValue/setInputValue/onDigit 变化才重建——防抖数字输入 hook 的参数包'),
    (50, 'after', 'useDebouncedDigitInput：数字键防抖输入，避免连按误触发两次选择'),
    (53, 'after', 'BLACK_CIRCLE 图标加加粗问题文案：隐私询问用 cyan 色圆点突出'),
    (60, 'after', 'Learn more 链接固定 dim 色：data-usage 文档锚点直指 session-quality-surveys 小节'),
]
