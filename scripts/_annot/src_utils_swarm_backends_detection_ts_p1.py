# 批注数据：src/utils/swarm/backends/detection.ts
# slug: src_utils_swarm_backends_detection_ts
ANNOTATIONS = [
    (3, 'after', '''本模块负责检测运行环境：判断是否在 tmux / iTerm2 内、tmux 是否可用、it2 CLI 是否可达，并缓存结果（进程生命周期内不变）。'''),
    (5, 'after', '''模块加载时即抓取用户原始的 TMUX 环境变量，用于判断 Claude 是否从 tmux 内启动；因为 Shell.ts 之后会改写 TMUX，故必须抓原始值。'''),
    (12, 'after', '''同理在模块加载时抓取 leader 的 tmux pane ID（tmux 会把它设为当前 pane，如 %0/%1），即便用户之后切换 pane 也能记住原始值。'''),
    (22, 'after', '''isInsideTmux 的缓存变量，进程生命周期内不变。'''),
    (26, 'after', '''isInITerm2 的缓存变量，进程生命周期内不变。'''),
    (27, 'after', '''同步版判断是否在 tmux 中——直接看加载时抓到的原始 TMUX 值；只查 TMUX 环境变量，不跑 tmux display-message（因为那条命令只要系统上有任何 tmux server 就会成功，无法区分是否本进程在 tmux 内）。'''),
    (50, 'after', '''异步版判断是否在 tmux 内，结果缓存（进程内不变）。'''),
    (66, 'after', '''返回模块加载时抓到的 leader pane ID，不在 tmux 内则 null。'''),
    (73, 'after', '''通过 tmux -V 判断是否安装了 tmux（在 PATH 中可用）。'''),
    (78, 'after', '''多手段检测是否在 iTerm2 内（TERM_PROGRAM=iTerm.app、ITERM_SESSION_ID 存在、env.terminal 判定）；结果缓存；iTerm2 后端用内建 AppleScript，无需外部 CLI。'''),
    (109, 'after', '''it2 CLI 命令名常量。'''),
    (117, 'after', '''用 it2 session list（而非 --version）检测 it2 是否可达 iTerm2 Python API——因为 --version 在 API 被禁用时也会成功，会导致后续 session split 无回退地失败。'''),
    (125, 'after', '''供测试用：清空所有检测缓存。'''),
]
