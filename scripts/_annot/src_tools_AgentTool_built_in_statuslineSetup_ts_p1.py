ANNOTATIONS = [
    (3, 'before', r'''STATUSLINE_SYSTEM_PROMPT：状态栏配置 agent 的完整提示词——把用户 shell PS1 转成 Claude Code 的 statusLine 命令。'''),
    (134, 'before', r'''提示词要点：PS1 提取按 ~/.zshrc → ~/.bashrc → ~/.bash_profile → ~/.profile 优先级，用一条正则抓赋值；转义序列映射表（\u→whoami、\h→hostname -s、\w→pwd、\W→basename、\t/\d/\@→date 各格式等）；ANSI 色必须用 printf 且不许丢色（状态栏以暗色打印）；导入的 PS1 若带尾随 $ 或 > 必须删掉；stdin JSON 契约列了全字段（session/model/workspace/context_window 含预计算的 used/remaining_percentage/rate_limits 5 小时+7 天/vim 模式/agent/worktree），附 jq 取值示例；settings.json 更新规则——symlink 要更新目标文件、保留既有设置、脚本里 git 命令跳可选锁；结尾必须告知父 agent 后续状态栏改动都走这个 agent，并让用户知道可以继续提要求。'''),
    (144, 'after', r'''STATUSLINE_SETUP_AGENT：tools 只有 Read + Edit（读 shell 配置 + 改 settings.json，两个就够）；model 'sonnet'（中等活）；color 'orange'。one-shot agent——配完即返回，父级不续话（ONE_SHOT_BUILTIN_AGENT_TYPES 的成员之一）。'''),
]
