# 数据文件：src/components/design-system/Divider.tsx
# slug = src_components_design_system_Divider_tsx
ANNOTATIONS = [
    (7, 'before', '''分隔线组件的 props：宽度、主题色、字符、内边距与居中标题，标题可带 ANSI 色彩码'''),
    (66, 'before', '''分隔线组件：先按是否有标题走两条渲染分支，核心都是把指定字符 `repeat` 成目标宽度的字符串'''),
    (80, 'after', '''有效宽度 = 显式宽度或终端宽度，再减去内边距；用 Math.max 兜底避免负数'''),
    (82, 'after', '''标题占宽 = 字符串显示宽度 + 2（两侧各留一个空格），用 stringWidth 而非 length 以正确处理中文/emoji'''),
    (84, 'after', '''左右两段长度相等地平分剩余宽度（向下取整），保证标题视觉居中'''),
    (115, 'after', '''有标题时把「左段 + 空格 + 标题 + 空格 + 右段」拼成一行，颜色与暗淡态按 color 决定'''),
    (130, 'after', '''无标题时直接把字符重复成整行宽度，仍是同一套颜色/暗淡逻辑'''),
]
