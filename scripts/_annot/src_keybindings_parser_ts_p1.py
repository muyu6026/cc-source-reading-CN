# -*- coding: utf-8 -*-
# 批注数据：src/keybindings/parser.ts
# 锚点 (行号, pos, 中文)。pos ∈ before/after/after_block。
ANNOTATIONS = [
    (1, 'after', '模块：键位字符串解析——把 `ctrl+shift+k` 这类输入翻译成结构化的按键描述。'),
    (13, 'before', '`parseKeystroke`：把单个按键串拆成含修饰键标志的结构体，支持多种别名（ctrl/control、alt/opt、cmd/command 等）。'),
    (80, 'before', '`parseChord`：把由空格分隔的多个按键串解析成按键序列（和弦）。'),
    (81, 'after', '特例：单独的空格字符本身就是空格键绑定，而不是分隔符。'),
    (89, 'before', '`keystrokeToString`：把结构化按键转回规范字符串用于展示。'),
    (105, 'before', '`keyToDisplayName`：把内部键名映射成人类可读的展示名（如 `up` 转成上箭头）。'),
    (143, 'before', '`chordToString`：把整个和弦转成展示字符串。'),
    (157, 'before', '`keystrokeToDisplayString`：按平台生成展示字符串，macOS 用 opt、其余用 alt。'),
    (181, 'before', '`chordToDisplayString`：按平台把和弦转成展示字符串。'),
    (191, 'before', '`parseBindings`：把配置里的键位块展开成扁平的绑定列表（每条含和弦、动作、上下文）。'),
]
