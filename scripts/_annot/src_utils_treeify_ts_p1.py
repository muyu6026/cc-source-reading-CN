# 批注数据：src/utils/treeify.ts

ANNOTATIONS = [
    (7, 'after', '''TreeNode 是递归结构：键映射到子节点、字符串或空。'''),
    (19, 'after', '''TreeifyOptions 控制是否显示值、隐藏函数、使用颜色及主题名与各类字符配色。'''),
    (26, 'after', '''TreeCharacters 定义分支、末分支、竖线与空位四种树形字符。'''),
    (33, 'after', '''DEFAULT_TREE_CHARS 用 figures 库提供的线形字符作为默认树形符号。'''),
    (35, 'after', '''treeify 是带 Ink 主题色支持的自定义树形渲染实现，源自社区 treeify 项目。'''),
    (53, 'after', '''colorize 按给定的主题键上色，无键则原样返回。'''),
    (144, 'after', '''growBranch 递归生长子树：先处理字符串与基础值，再处理循环引用、对象、数组与函数。'''),
    (150, 'after', '''对空对象或单空键等特殊情况直接返回内置文案或特例字符串。'''),
    (166, 'after', '''对单键且值为字符串的特殊情形直接拼出末分支加值。'''),
    (170, 'after', '''treeify 收尾：从根开始生长并拼接所有行，返回带主题色的树形文本。'''),
]
