# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件集中定义队友 / swarm 会话相关的常量与命名：团队 Lead 名、swarm 会话名、tmux 命令、隐藏会话名，以及若干队友进程的环境变量键名。'''),
    (12, 'before', '''getSwarmSocketName：当用户不在 tmux 中时，为外部 swarm 会话生成独立 socket 名（含进程 pid 以隔离多个 Claude 实例），与用户自己的 tmux 会话互不干扰。'''),
    (21, 'before', '''三枚 TEAMMATE_*_ENV_VAR 常量：分别定义队友进程的启动命令覆盖键、分配颜色键、以及是否强制先进入 plan 模式再写代码的开关键。'''),
]
