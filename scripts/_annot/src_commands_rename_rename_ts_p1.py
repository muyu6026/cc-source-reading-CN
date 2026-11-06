# -*- coding: utf-8 -*-
# 第 167 批：src/commands/rename/rename.ts 批注数据
ANNOTATIONS = [
    (1, 'after', '''依赖：UUID 类型、会话 id、桥接配置覆盖、命令上下文、消息工具、记忆存储、队友判定、名称生成。'''),
    (19, 'after', '''imports 收尾；generateSessionName 在本目录内，用于无参时自动起名。'''),
    (25, 'after', '''call 入口：接收 onDone、context、args，返回 Promise<null>。'''),
    (33, 'after', '''队友限制：swarm 队友不能改名，名字由队长设定。'''),
    (51, 'after', '''新名来源：无参就调用生成器按对话内容起名，有参就直接用用户输入。'''),
    (57, 'after', '''持久化标题：无论哪种来源都先 saveCustomTitle 落盘。'''),
    (73, 'after', '''桥接同步：有 bridgeSessionId 就动态 import 更新远端标题（best-effort 不阻塞）。'''),
    (76, 'after', '''同步 agent 名：同时把名字存为 agent name，供提示栏显示。'''),
    (83, 'after', '''更新 AppState：把 standaloneAgentContext.name 改成新名，界面即时反映。'''),
    (87, 'after', '''收尾：回显「已重命名为某名」并 return null。'''),
]
