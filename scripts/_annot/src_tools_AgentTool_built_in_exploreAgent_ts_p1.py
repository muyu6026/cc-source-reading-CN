ANNOTATIONS = [
    (13, 'before', r'''getExploreSystemPrompt：Explore 的系统提示词生成器——embedded 分支让同一份提示词适配两种构建。'''),
    (22, 'after', r'''ant 原生构建把 find/grep 别名到内嵌 bfs/ugrep 并移除专用 Glob/Grep 工具，所以提示词改指导用 Bash 跑 find/grep。hasEmbeddedSearchTools() 在模块加载时求值——构建期常量，不是运行时开关。'''),
    (57, 'after', r'''提示词核心是 READ-ONLY 七禁：建/改/删/移/拷贝文件、建临时文件（含 /tmp）、重定向和 heredoc、任何改系统状态的命令。Bash 只放行 ls/git status/log/diff/find/cat/head/tail 白名单，并明列 mkdir/touch/rm/cp/mv/git add/commit/npm install 等禁项。定位是快速 agent：并行工具调用、尽快返回、最终报告直接作为普通消息（不落文件）。'''),
    (59, 'after', r'''EXPLORE_AGENT_MIN_QUERIES：Explore 至少要跑 3 次查询——防一次 grep 没摸到鱼就汇报「没找到」。导出给调用方做完成度校验。'''),
    (62, 'after', r'''EXPLORE_WHEN_TO_USE 要求调用方显式指定 thoroughness 级别（quick / medium / very thorough）——探索深度是输入参数，不是 agent 自己猜的。'''),
    (83, 'after', r'''EXPLORE_AGENT 定义：disallowedTools 五件——Agent（禁嵌套 spawn）、ExitPlanMode（禁计划交互）、三个写工具。model 分构建：ant 用 inherit（主模型质量优先），外部用 haiku（求快）。omitClaudeMd: true——只读搜索 agent 不需要 commit/PR/lint 规则，主 agent 有完整 CLAUDE.md 并解读它的输出。'''),
]
