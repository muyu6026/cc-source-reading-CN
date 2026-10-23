ANNOTATIONS = [
    (12, 'after', r'''AgentMemoryScope 三档：user 跨项目（~/.claude/agent-memory/）、project 团队共享（.claude/agent-memory/，进 VCS）、local 机器私有（.claude/agent-memory-local/，不进 VCS）。'''),
    (15, 'after', r'''sanitizeAgentTypeForPath：冒号换横线——冒号 Windows 非法，而插件命名空间 agent 类型（my-plugin:my-agent）恰恰带冒号，目录名必须先安全化。'''),
    (22, 'after', r'''全局 replace 而不是只换第一个：嵌套命名空间（a:b:c）也要完整处理。'''),
    (44, 'after', r'''getLocalAgentMemoryDir：CLAUDE_CODE_REMOTE_MEMORY_DIR 设置了就持久化到挂载卷并加 projects/<canonical git root> 命名空间（不同机器/不同 checkout 不串）；否则退回 cwd/.claude/agent-memory-local/。返回值末尾补 sep——后续 join 前是路径拼接哨兵。'''),
    (65, 'after', r'''getAgentMemoryDir 三 scope 路由。switch 穷尽三分支不写 default——TS 靠这个在 AgentMemoryScope 新增成员时让这里编译失败，逼着处理新 scope。'''),
    (104, 'after', r'''isAgentMemoryPath：判断路径是否落在任一 agent memory 目录（权限系统用——memory 目录内的读写放宽）。normalize 防 .. 穿越；user scope 查 memoryBase（可能被自定义过）；project 恒 cwd 不重定向；local 看 REMOTE_MEMORY_DIR 分流——remote 分支用 includes(sep + 'agent-memory-local' + sep) 而不是 startsWith：挂载卷下 projects/<root>/ 前缀因 root 各异，没法简单前缀匹配。'''),
    (114, 'after', r'''getAgentMemoryEntrypoint：MEMORY.md 是 memory 目录的入口文件（与主 memory 体系同约定）。'''),
    (129, 'after', r'''getMemoryScopeDisplay：/agents 命令显示用；local scope 显示真实目录路径（传 '...' 占位取目录形态而非真 agent 名）。'''),
    (138, 'before', r'''loadAgentMemoryPrompt：给开了 memory 的 agent 生成带 memory 内容的提示段。'''),
    (156, 'after', r'''scopeNote 按 scope 定制行为指引：user 档要通用（跨项目复用）、project 档 tailoring 本项目（团队共享）、local 档 tailoring 本项目+本机。'''),
    (165, 'after', r'''ensureMemoryDirExists fire-and-forget：本函数跑在同步的 getSystemPrompt() 回调里（AgentDetail.tsx 的 React render 会调，不能 async）。时序上 agent 发起第一次 Write 前有一整个 API 往返，mkdir 早完成了；万一没完成，FileWriteTool 自己会建父目录——双保险，所以这里敢不等。'''),
    (177, 'after', r'''CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES 环境变量可往提示里追加额外指引（cowork 场景注入团队规范）；buildMemoryPrompt 统一组装 displayName + memoryDir + extraGuidelines。'''),
]
