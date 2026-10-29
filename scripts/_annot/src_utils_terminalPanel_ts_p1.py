# 数据文件：src/utils/terminalPanel.ts

ANNOTATIONS = [
    (1, 'after', '''文件级：内置终端面板，Meta+J 切换；用 tmux 维护持久 shell 会话，每个实例持有独立 socket，实例退出即销毁；无 tmux 时退回非持久 shell。'''),
    (25, 'after', '''TMUX_SESSION 常量：固定会话名 panel，所有实例共用同一 tmux 会话名，靠 socket 区分彼此。'''),
    (36, 'after', '''getTerminalPanelSocket：取 session UUID 前 8 位拼成唯一 socket 名，保证每个实例的终端面板互相隔离。'''),
    (48, 'after', '''getTerminalPanel：懒加载单例，首次使用时创建 TerminalPanel。'''),
    (72, 'after', '''checkTmux：缓存式探测 tmux 是否可用，不可用时记日志并退回非持久 shell。'''),
    (81, 'after', '''hasSession：判断当前 socket 下 panel 会话是否已存在。'''),
    (142, 'after', '''createSession：用当前 shell 与 cwd 在独立 socket 上新建 tmux 会话；绑定 Meta+J 返回 Claude、配置状态栏提示，并注册清理时杀掉 tmux server。'''),
    (150, 'after', '''attachSession：把已存在的 tmux 会话挂接回终端（inherit stdio）。'''),
    (171, 'after', '''showShell：进入备用屏后，有 tmux 则确保会话存在并挂接，否则直接跑 shell；finally 中退出备用屏。'''),
    (179, 'after', '''ensureSession：会话已存在直接返回，否则创建。'''),
    (190, 'after', '''runShellDirect：无 tmux 时的兜底，用交互式登录 shell 直接运行。'''),
]
