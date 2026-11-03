# 数据文件：src/components/agents/AgentsMenu.tsx
# slug = src_components_agents_AgentsMenu_tsx
# 规则：一个源文件 = 一个数据文件；中文用三引号；禁止英文双引号 " 与反斜杠 \（用「」/『』代替）。
ANNOTATIONS = [
    (1, 'before', '''本文件是 Agents（智能体）管理菜单组件，用基于 modeState 的状态机在同一个界面里切换「列表 / 新建 / 单个智能体菜单 / 查看 / 编辑 / 删除确认」等模式。文件由 React Compiler 编译，满屏的 $[k] 记忆槽等价于带依赖比较的 useMemo，直接看逻辑即可。'''),
    (25, 'before', '''Props 只接收两样东西：tools（当前可用工具集）与 onExit（退出时回调，可带一行变更摘要文本）。'''),
    (31, 'before', '''AgentsMenu 主组件入口。先初始化 modeState（默认 list-agents / 全来源）与 changes（本次会话里对智能体的变更记录），再从全局状态取出全部智能体定义、mcp 工具与权限上下文。'''),
    (47, 'after', '''modeState 用 useState 持有，描述当前处于哪个模式以及选中的智能体来源或具体智能体；changes 则在每次增删改后追加一条人类可读的提示，退出时回传给 onExit。'''),
    (63, 'after', '''changes 初始为空数组，后续每次创建 / 删除 / 编辑成功都会向其中 push 一条记录。'''),
    (64, 'after', '''mergedTools 把内置工具、mcp 工具与权限上下文合并成统一工具集，供新建 / 编辑向导使用；下方的 t3 至 t9 通过 _temp4 至 _temp9 把全部智能体按来源（内置 / 用户设置 / 项目 / 策略 / 本地 / 旗标 / 插件）分组。'''),
    (146, 'after', '''agentsBySource 是把所有智能体按七个来源分组后的对象（外加 all 聚合），列表模式据此按当前 source 过滤展示。'''),
    (160, 'after', '''handleAgentCreated 在创建向导完成后调用：把成功消息推入 changes，并切回 list-agents 全来源视图。'''),
    (193, 'after', '''handleAgentDeleted 负责真正删除：先调 deleteAgentFromFile 改磁盘文件，再更新 AppState 里的 allAgents 与 activeAgents（用 getActiveAgentsFromList 重算），失败则记日志。'''),
    (194, 'before', '''整组件是一个 switch 状态机，按 modeState.mode 分派到不同的渲染分支，每个分支都用记忆槽缓存各自的子组件，减少重渲染。'''),
    (231, 'after', '''列表模式的退出处理器：把 changes 拼成一行「Agent changes: …」摘要传给 onExit，无变更时回退给默认文案并标记 system 展示。'''),
    (280, 'after', '''list-agents 分支渲染 AgentsList（按来源过滤并用 resolveAgentOverrides 叠加激活态）再附导航底栏，用户可进入详情或新建。'''),
    (303, 'after', '''create-agent 分支挂载 CreateAgentWizard 向导，完成走 handleAgentCreated，取消则回列表。'''),
    (415, 'after', '''agent-menu 分支先把当前智能体从 allAgents 里按类型加来源找回最新实例，再组装菜单项（查看 / 可编辑时追加编辑与删除），handleMenuSelect 据此切到对应子模式。'''),
    (484, 'after', '''view-agent 分支用 AgentDetail 展示只读详情，提供返回入口。'''),
    (569, 'after', '''delete-confirm 分支先确认，再用 handleAgentDeleted 真正删除，并把来源一并显示以避免误删。'''),
    (679, 'after', '''delete-confirm 分支组装「是 / 否」选项与确认文案，选中 yes 才调用 handleAgentDeleted，否则回上一模式；异常路径不会真正删文件。'''),
    (762, 'after', '''edit-agent 分支挂载 AgentEditor，保存后走 handleAgentCreated 并回到上一模式。'''),
    (769, 'after', '''AgentsMenu 组件收尾：default 分支返回 null，状态机到此闭合。'''),
    (770, 'before', '''文件末尾一组 _temp0 至 _temp9（以及 _temp）是 React Compiler 提升出的纯函数谓词：各自按 source 字段从 allAgents 里筛出一个来源分组，供上面的分组逻辑复用。'''),
    (799, 'after', '''_temp 从 AppState 里取出 agentDefinitions，作为 useAppState 的选择器供主组件读取全部智能体定义。'''),
]
