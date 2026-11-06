# 数据文件：source/src/commands/vim/vim.ts
ANNOTATIONS = [
    (1, 'after', """/vim 命令：在「vim」与「normal」编辑模式间切换；旧版「emacs」按「normal」处理，写回设置并打点。"""),
    (8, 'after', """命令入口：读全局配置拿当前编辑模式。"""),
    (10, 'after', """默认 normal，兼容旧 emacs 视为 normal。"""),
    (13, 'after', """emacs 一律按 normal 处理（向后兼容）。"""),
    (17, 'after', """normal 切 vim，否则切回 normal。"""),
    (19, 'after', """写回全局配置。"""),
    (24, 'after', """打点记录模式变化与来源（command）。"""),
    (30, 'after', """返回文本提示：vim 模式告知用 Esc 切换，normal 告知用标准按键绑定。"""),
]
