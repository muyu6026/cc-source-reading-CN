# 源文件: src/commands/exit/exit.tsx
ANNOTATIONS = [
    (10, 'after', '''退出时随机展示的告别语候选池，每次 /exit 从中抽一条。'''),
    (12, 'after', '''用 lodash 的 sample 随机抽一条；空结果（理论上不会）回退到 Goodbye!。'''),
    (15, 'after', '''命令入口 call：接收 onDone 回调，返回 ReactNode（禁用命令可渲染确认界面）。'''),
    (18, 'after', '''后台会话分支（claude --bg 的 tmux 会话）：只 detach 不 kill，REPL 继续运行，claude attach 可重连。/exit、/quit、ctrl+c、ctrl+d 全都汇到这里。'''),
    (27, 'after', '''有工作树会话时渲染 ExitFlow 组件让用户选退出方式；onCancel 也直接 onDone 关闭。'''),
    (30, 'after', '''前台无工作树：先回一句随机告别语，再优雅关机（退出码 0，来源标记为 prompt_input_exit）。'''),
]
