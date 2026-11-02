ANNOTATIONS = [
    (1, 'before', """模块总述：本文件是 agent teams / teammate 功能的统一运行时开关，作为全代码库引用队友能力时的唯一判据闸门，集中处理内外部构建的差异与 killswitch。"""),
    (10, 'before', """私有辅助函数 isAgentTeamsFlagSet：直接从 process.argv 读取 `--agent-teams` 标志，刻意不经由 bootstrap / state 模块以避免引入 import 环。"""),
    (24, 'before', """公开闸门 isAgentSwarmsEnabled：全代码库判断是否启用队友功能的唯一入口，prompts、工具、UI 等都应调用它而非各自判断。"""),
    (39, 'after', """killswitch 判定：外部构建下即便用户已 opt-in，只要 GrowthBook 的 `tengu_amber_flint` 开关关闭（取缓存值，可能略旧）就一律拒绝启用。"""),
]
