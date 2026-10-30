# 批注数据：src/utils/swarm/teammateInit.ts
# slug: src_utils_swarm_teammateInit_ts
ANNOTATIONS = [
    (1, 'after', '''队友初始化模块：为以「队友」身份运行在 swarm 集群中的 Claude Code 实例做初始化，注册一个 Stop 钩子，在本队友空闲时通知团队 leader。'''),
    (21, 'after', '''初始化队友的钩子——应在 AppState 就绪后尽早调用；注册 Stop 钩子，在队友会话结束时向 leader 发空闲通知。'''),
    (32, 'after', '''参数含 setAppState 更新器、sessionId 与团队信息（队名/agentId/agentName）。'''),
    (35, 'after', '''读取团队文件拿到 leader 的 ID；找不到团队文件就直接返回。'''),
    (44, 'after', '''若团队配置了全局允许路径，逐个将「工具名 加 路径」加为 allow 规则（绝对路径前补斜杠形成 //path/双星号 模式，相对路径直接用 path/双星号）。'''),
    (81, 'after', '''从成员数组里找出 leader 的名字（找不到用 team-lead 兜底）。'''),
    (85, 'after', '''若本机就是 leader，则不注册空闲通知钩子（leader 不需要通知自己）。'''),
    (97, 'after', '''注册 Stop 钩子，在队友停止时通知 leader。'''),
    (103, 'after', '''钩子回调：先把本队友标记为空闲（fire-and-forget），再向 leader 邮箱发送空闲通知，包含空闲原因与最近的对等私信摘要。'''),
    (122, 'after', '''返回 true 表示不阻断 Stop 流程。'''),
    (124, 'after', '''钩子失败时的错误提示文案。'''),
    (127, 'after', '''钩子超时设为 10 秒，避免关闭流程被卡住。'''),
]
