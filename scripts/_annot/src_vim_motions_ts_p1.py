# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (7, 'after', '''导入 Cursor 类型（光标的纯计算抽象）'''),
    (13, 'after', '''resolveMotion：按 count 重复应用单步动作，纯计算不修改任何状态'''),
    (19, 'after', '''循环 count 次，若某步光标不再移动则提前结束'''),
    (30, 'after', '''applySingleMotion：单步动作查表，把按键映射到 Cursor 方法'''),
    (33, 'after', '''h / l：左 / 右移动一个字符'''),
    (37, 'after', '''j / k：按逻辑行上 / 下移动'''),
    (41, 'after', '''gj / gk：按屏幕行（视觉行）上 / 下移动'''),
    (44, 'after', '''w / b / e：按 vim 词（word）前跳 / 后跳 / 词尾'''),
    (49, 'after', '''e：跳到 vim 词的结尾（含终点字符）'''),
    (57, 'after', '''0 / ^ / $：行首 / 首个非空白 / 行尾'''),
    (61, 'after', '''$：跳到逻辑行末尾'''),
    (63, 'after', '''G：跳到最后一行的行首'''),
    (72, 'after', '''isInclusiveMotion：判定动作是否含终点字符（e / E / $）'''),
    (80, 'after', '''isLinewiseMotion：判定动作是否按整行操作（j / k / G / gg）'''),
]
