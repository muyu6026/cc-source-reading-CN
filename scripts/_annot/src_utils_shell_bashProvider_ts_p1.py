# Bash 执行提供器：把一条命令拼成「source 快照 + 会话环境 + 关 extglob + eval」的串，并处理 tmux 隔离
ANNOTATIONS = [
    (39, 'before', '''生成关闭扩展通配（extglob）的命令，bash 和 zsh 写法不同，有 shell 前缀时要两边都发'''),
    (58, 'before', '''创建 Bash 执行提供器，先异步建一份 shell 快照（失败也不致命）'''),
    (77, 'before', '''拼出真正要执行的命令串：先 source 快照与会话环境，再关 extglob，最后 eval 用户命令'''),
    (93, 'after', '''快照中途被删（tmpdir 清理）就放弃快照、退回登录 shell，否则 source 会静默失败'''),
    (200, 'before', '''决定 spawn 参数：有快照就跳过 -l 登录标志，直接复用快照环境'''),
    (208, 'before', '''计算要注入的环境变量，包括 tmux 隔离与沙箱临时目录'''),
    (220, 'after', '''tmux socket 隔离延迟到真正用到 tmux 时才初始化，省下启动开销'''),
    (232, 'after', '''强制把 TMUX 指到 Claude 自己的隔离 socket，避免污染用户原有 tmux'''),
    (248, 'after', '''把沙箱临时目录和会话环境变量一并写进 env 后返回'''),
]
