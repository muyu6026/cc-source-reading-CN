# -*- coding: utf-8 -*-
"""src/keybindings/match.ts 批注数据（第 165 批）。"""

ANNOTATIONS = [
    (4, 'before', '''只取 Ink 的四种修饰键；fn 故意排除，因为它在终端里很少用也不常配'''),
    (9, 'before', '''修饰键的子类型：从 Ink 的 Key 里挑出 ctrl、shift、meta、super 四个'''),
    (15, 'before', '''显式抽取我们关心的修饰键，避免把无关字段带进来'''),
    (24, 'before', '''把 Ink 的布尔标志（escape、return、…）映射成 ParsedKeystroke 用的字符串名'''),
    (29, 'before', '''单字符按键直接用原值小写；特殊键各有一行映射'''),
    (45, 'before', '''普通字符键：长度为一就转小写，大小写不敏感地匹配'''),
    (49, 'before', '''修饰键匹配：alt 与 meta 在 Ink 里都走 key.meta，所以配置里的 meta 其实是 alt 的别名'''),
    (60, 'before', '''四个修饰键逐一比对，任何一项不等就判不匹配'''),
    (72, 'before', '''把 alt 与 meta 合并成需要 meta 一个维度，处理终端把 Alt 写成 meta 的历史行为'''),
    (81, 'before', '''单键匹配的总入口：先比键名再比修饰键；展示文字按平台给 opt 或 alt'''),
    (86, 'before', '''先取键名，不等直接返回；再取修饰键交给 modifiersMatch'''),
    (96, 'before', '''Ink 按 esc 时会把 key.meta 置真（历史遗留），匹配 escape 本身时要忽略这个 meta'''),
    (107, 'before', '''只匹配绑定第一拍的键：用于单键绑定（Phase 1 和弦只取首拍）'''),
    (111, 'before', '''和弦长度不是 1 直接返回 false；取第一拍交给 matchesKeystroke'''),
]
