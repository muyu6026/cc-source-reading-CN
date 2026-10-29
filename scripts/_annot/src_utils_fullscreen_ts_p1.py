ANNOTATIONS = [
    (13, 'after', '''WS_CONNECTING 与 WS_OPEN 两个就绪状态常量，原生 WebSocket 与 ws 包取值一致，用于判断连接是否已建立。'''),
    (14, 'after', '''tmuxControlModeProbed 缓存 tmux 控制模式的探测结果，undefined 表示尚未查询或探测失败，由 env 启发式优先给出权威答案。'''),
    (36, 'after', '''isTmuxControlModeEnvHeuristic 基于 TMUX、TERM_PROGRAM 与 TERM 三个环境变量做快速启发式判断，作为零子进程的捷径。'''),
    (86, 'after', '''probeTmuxControlModeSync 同步一次性探测 tmux 控制模式，结果缓存以避免每次渲染重复派生进程。'''),
    (100, 'after', '''isTmuxControlMode 在首次调用且启发式无法判定时懒触发同步探测，之后直接返回缓存值。'''),
    (105, 'after', '''_resetTmuxControlModeProbeForTesting 重置模块级探测缓存与日志标志，仅供测试使用。'''),
    (129, 'after', '''isFullscreenEnvEnabled 收尾：显式开关优先，其次在 tmux -CC 下自动禁用（全屏会破坏终端状态），最后按用户类型默认。'''),
    (142, 'after', '''isMouseTrackingEnabled 默认开启 SGR 鼠标追踪，可用环境变量关闭以保留终端原生复制选中。'''),
    (153, 'after', '''isMouseClicksDisabled 判断鼠标点击是否禁用，仅在全屏场景下可达，用于防止误触改变光标位置。'''),
    (164, 'after', '''isFullscreenActive 要求既是交互式 REPL 又未显式关闭全屏，无头路径永不进入全屏。'''),
    (196, 'after', '''maybeGetTmuxMouseHint 在满足条件时返回一次性鼠标设置提示，避免改动 tmux 的会话级鼠标状态。'''),
    (202, 'after', '''_resetForTesting 重置会话级一次性标志，仅供测试使用。'''),
]
