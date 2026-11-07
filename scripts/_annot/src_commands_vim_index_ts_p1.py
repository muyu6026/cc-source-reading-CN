# 批注数据：src/commands/vim/index.ts
ANNOTATIONS = [
    (1, 'after', '''`/vim` 命令的注册入口，用于在 Vim 编辑模式与常规模式之间切换。'''),
    (6, 'after', '''`supportsNonInteractive: false` 声明该命令依赖交互式编辑器状态，不能在管道或脚本等非交互场景调用。'''),
    (9, 'after', '''`type` 取值 `local` 表示纯本地逻辑、不渲染 JSX 对话框，区别于 `local-jsx`。'''),
]
