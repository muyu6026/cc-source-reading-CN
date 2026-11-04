ANNOTATIONS = [
    (1, 'before', '''React Compiler 运行时入口。'''),
    (4, 'before', '''直接从 `../../ink/components/Text.js` 引入底层 `Text`，本组件是它的「主题感知」包装层。'''),
    (9, 'before', '''块注释说明 `TextHoverColorContext`：给子树里未显式指定颜色的 ThemedText 统一上色，优先级为「显式 color > hover > dimColor」，且能跨 Box 边界生效（Ink 原生样式级联做不到）。'''),
    (11, 'before', '''`TextHoverColorContext` 是一个 React Context，用于悬停时统一给未着色文字染色。'''),
    (12, 'before', '''Props 提供完整的文字样式开关：color、backgroundColor、dimColor、bold、italic、underline、strikethrough、inverse、wrap，全部为只读可选。'''),
    (66, 'before', '''`resolveColor` 把可能是「主题键」的颜色解析成原始 `Color`：若以 `rgb(`、`#`、`ansi256(`、`ansi:` 开头则视为原始值直接返回，否则按主题键查表。'''),
    (80, 'before', '''ThemedText 是主题感知的文字组件，把主题键解析成实际颜色后转发给底层 `Text`。'''),
    (81, 'before', '''`_c(10)` 申请 10 个记忆槽位。'''),
    (94, 'before', '''一组带缺省值的布尔样式：未传时 dimColor/bold/italic/underline/strikethrough/inverse 均为 false，wrap 缺省为 `wrap`（自动折行）。'''),
    (101, 'before', '''从 `useTheme` 取主题名再 `getTheme` 得到主题对象，并读取悬停色 `hoverColor`。'''),
    (104, 'before', '''`resolvedColor` 的优先级：未指定 color 且有 hover 色则用 hover 色；否则 dimColor 时用主题的 inactive 色；否则解析显式 color。'''),
    (107, 'before', '''记忆底层 `Text` 元素：把所有解析后的样式与子内容一次性传给 `Text`，得到最终渲染 `t8`。'''),
]
