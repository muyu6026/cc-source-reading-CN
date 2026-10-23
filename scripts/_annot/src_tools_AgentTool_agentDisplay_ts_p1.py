ANNOTATIONS = [
    (1, 'after', r'''agentDisplay：agent 信息的展示层共享工具——CLI 的 claude agents 处理器和交互式 /agents 命令共用，保证两处口径一致。'''),
    (18, 'after', r'''AgentSourceGroup：标签 + source 判别式。'''),
    (32, 'after', r'''AGENT_SOURCE_GROUPS 是展示顺序：user → project → local → managed → plugin → CLI arg → built-in。注意与 getActiveAgentsFromList 的覆盖优先级不是一回事——那是「谁赢」，这是「怎么排」（built-in 垫底因为最没信息量）。'''),
    (36, 'after', r'''ResolvedAgent：AgentDefinition + overriddenBy——UI 要能显示「这个 agent 被更高优先级的源覆盖了」。'''),
    (46, 'before', r'''resolveAgentOverrides：把全量 agent 列表标注上覆盖关系。'''),
    (72, 'after', r'''两个细节：activeMap 按 agentType 建索引（赢家列表）；遍历全量列表时按 (agentType, source) 去重——git worktree 场景同一份 agent 文件会从 worktree 和主仓库各加载一次，不去重列表里出现两条一模一样的。active 存在且源不同才标 overriddenBy。'''),
    (84, 'after', r'''resolveAgentModelDisplay：没声明 model 取默认 subagent 模型；'inherit' 原样返回（显示用，不做解析）。'''),
    (92, 'after', r'''getOverrideSourceLabel：小写 source 名（user/project/managed）——覆盖提示文案里用。'''),
    (104, 'after', r'''compareAgentsByName：localeCompare + sensitivity: 'base'——大小写不敏感排序，Agent 和 agent 相邻，列表稳定。'''),
]
