ANNOTATIONS = [
    (1, 'after', '''文件级说明：蜂群重连模块，负责在冷启动与会话恢复两种场景下为队友（teammate）装配 teamContext。'''),
    (14, 'after', '''依赖注入：从团队辅助模块读取团队文件，从调试与日志模块取日志函数。'''),
    (66, 'after', '''computeInitialTeamContext 收尾：冷启动路径，优先读 CLI 动态团队上下文，读不到团队文件则返回 undefined，表示当前并非队友进程。'''),
    (68, 'after', '''第二段块注释：会话恢复路径入口，描述从 transcript 存下的 teamName/agentName 重建上下文。'''),
    (119, 'after', '''initializeTeammateContextFromSession 收尾：按 agentName 在团队文件里找成员，写回 AppState.teamContext，使心跳等蜂群功能正常工作。'''),
]
