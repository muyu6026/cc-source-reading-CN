# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (11, 'before', '默认最多渲染 10 行——工具报错往往是大段堆栈，聊天流里只给头 10 行加省略提示。'),
    (16, 'before', 'FallbackToolUseErrorMessage：所有工具调用的兜底错误渲染。result 可能是字符串也可能是块数组，本组件负责把它归一成红字错误块。'),
    (22, 'before', 'transcript 快捷键文案来自 useShortcutDisplay：键位可被用户重映射，显示实际绑定而不是写死 ctrl+o。'),
    (30, 'before', '整个错误归一管线在一个大缓存块里：依赖只有 result 与 verbose 两个。注意编译器把 Box、Text、MessageResponse 三个组件提升到 T0、T1、T2 局部变量——组件身份也参与缓存。'),
    (32, 'before', '归一第一层：非字符串结果（块数组）没有可读文本，直接给通用文案。'),
    (35, 'before', '第二层：从结果里抽 tool_use_error 标签内容，抽不到就用原文。第三层去掉沙箱违规标签与 error 标签——这些是机器标记，不该露给用户。'),
    (39, 'before', '第四层：非 verbose 下把 InputValidationError 折叠成「参数无效」——参数校验错误的原文动辄几十行 JSON schema 说明，用户只需要知道输错了。'),
    (42, 'before', '第五层：已有 Error: 或 Cancelled: 前缀就保留，否则补一个——保证错误块的首词永远是 Error，视觉扫描时一行定位。'),
    (49, 'before', 'plusLines：总行数减 10。行数用换行符计数加一算出，避免 split 建整个数组。'),
    (55, 'before', 'verbose 给全文，否则 split 取前 10 行再拼回——截断发生在 stripUnderlineAnsi 之前，被截掉的行连 ANSI 清理都省了。'),
    (86, 'before', '省略提示：只在非 verbose 且确实有剩余行时显示，附实际键位文案。单复数按 plusLines 是否为一。'),
]
