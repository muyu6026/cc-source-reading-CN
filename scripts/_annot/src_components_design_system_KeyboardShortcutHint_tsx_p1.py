# -*- coding: utf-8 -*-
# annotations for src/components/design-system/KeyboardShortcutHint.tsx (82 lines)
ANNOTATIONS = [
    (4, 'before', 'Props：shortcut 与 action 必填，parens 与 bold 可选'),
    (15, 'before', 'doc 注释给四种用法：普通、带括号、加粗键名、多枚用 Byline 串联，并说明常见写法是外层套 Text dimColor'),
    (46, 'after', 'parens 与 bold 默认 false：解构默认值被展开成三元'),
    (50, 'after', 'bold 时把键名包成加粗 Text，否则原样透传字符串——所以 shortcutText 可能是字符串也可能是元素'),
    (58, 'after', 'parens 分支单独早退：括号版自己一套缓存槽，避免与普通版互相覆盖'),
    (61, 'after', '括号版：左括号加键名加 to 加动作加右括号'),
    (72, 'after', '普通版：键名 to 动作，不带括号'),
]
