# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'after', '''// 块注释：swarm 初始化 hook——初始化 teammate hooks 与 context；处理 fresh spawn 与 resume 两种；条件加载以便 swarms 禁用时 DCE 剔除。'''),
    (22, 'after', '''// 块注释：ENABLE_AGENT_SWARMS=true 时初始化；resume（--resume / /resume）从 transcript 消息读 teamName/agentName；fresh spawn 从环境变量读 context。'''),
    (34, 'after', '''// 仅在 enabled 且 isAgentSwarmsEnabled 时初始化；处理 resume 与 fresh spawn 两条路径，二者互斥。'''),
    (80, 'after', '''// effect：resume 从转录首消息读 teamName/agentName → initializeTeammateContextFromSession 重建 context + 从 team file 取 agentId 初始化 hooks；fresh 从 getDynamicTeamContext（main.tsx 已算进 initialState）初始化 hooks。'''),
]
