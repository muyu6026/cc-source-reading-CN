# 源文件: src/commands/desktop/index.ts
ANNOTATIONS = [
    (3, 'after', '''平台白名单判定：只有 macOS（darwin）或 Windows x64 才支持桌面端命令。'''),
    (11, 'after', '''其余平台（如 Linux、Windows ARM）一律返回 false，命令隐藏。'''),
    (13, 'after', '''命令定义：在 Claude Desktop 中继续当前会话；别名 app，availability 限 claude-ai。'''),
    (24, 'after', '''满足 Command 类型；isEnabled 等于平台支持判定，get isHidden 反向控制可见性，按需懒加载 desktop.js。'''),
]
