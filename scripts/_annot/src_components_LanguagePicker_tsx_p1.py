# -*- coding: utf-8 -*-
# annotations for src/components/LanguagePicker.tsx (86 lines)
ANNOTATIONS = [
    (12, 'before', '语言选择器：文本输入加受控光标偏移，提交时 trim，空值回落默认英语'),
    (19, 'after', 'language 初值允许是 undefined：代表「尚未设置」'),
    (20, 'after', '光标初值放在已有文本末尾：编辑既有设置时不用先按 End'),
    (30, 'after', 'confirm:no 绑定在 Settings 上下文：源码注释解释了原因——否则在输入框里打字母 n 会被当成取消'),
    (33, 'after', 'handleSubmit：trim 后空串统一转成 undefined，等价于「用默认值」'),
    (46, 'after', '提示文案要求同时给出语言名与语音语言：一个字段同时影响回复语言与语音合成'),
    (61, 'after', 'TextInput 全受控：value/onChange/onSubmit 加 focus/showCursor/columns 等于 60，placeholder 给三种语言样例（含日中），cursorOffset 双向受控'),
    (71, 'after', '底部暗色说明：留空即默认英语——把「清空」这条隐形操作显式写出来'),
]
