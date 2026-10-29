# 数据文件：src/utils/swarm/spawnUtils.ts
SOURCE_PATH = 'src/utils/swarm/spawnUtils.ts'

ANNOTATIONS = [
    (1, 'after', '''本文件提供跨后端派生 teammate 进程的共享工具：决定可执行路径、构建要继承的 CLI 标志与环境变量，确保子智能体继承父会话的关键配置。'''),
    (28, 'after', '''getTeammateCommand：优先用环境变量指定的命令，否则按打包模式取当前进程可执行文件路径或脚本入口。'''),
    (56, 'after', '''权限模式继承：计划模式优先（不继承 bypass），否则按 bypassPermissions / acceptEdits 追加对应 CLI 标志。'''),
    (89, 'after', '''buildInheritedCliFlags：汇总继承标志——权限模式、模型、设置路径、内联插件目录、teammate 模式与 chrome 开关，用引号包裹避免注入。'''),
    (128, 'after', '''TEAMMATE_ENV_VARS：需显式转发给 tmux 派生 teammate 的环境变量，涵盖 API 提供方选择、配置目录、CCR 标记、代理与证书等。'''),
    (146, 'after', '''buildInheritedEnvVars：拼接 env 字符串，固定注入 CLAUDECODE=1 与实验性团队标志，再追加当前进程里已设置的 provider/config/proxy 变量。'''),
]
