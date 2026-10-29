# 数据文件：src/utils/sessionState.ts
SOURCE_PATH = 'src/utils/sessionState.ts'

ANNOTATIONS = [
    (1, 'after', '''本模块管理会话状态机（idle/running/requires_action）并把阻塞动作、任务摘要等镜像进 external_metadata 与 SDK 事件流，供 CCR 与 IDE 客户端消费。'''),
    (24, 'after', '''RequiresActionDetails：requires_action 转变时携带的上下文，含工具名、可读摘要、tool_use_id 与请求 id，便于下游展示阻塞原因。'''),
    (45, 'after', '''SessionExternalMetadata：写入 CCR external_metadata 的键集合，含权限模式、超计划模式、模型、pending_action 与任务摘要。'''),
    (58, 'after', '''三类监听器（状态、元数据、权限模式）的模块级引用，由对应 setter 注册。'''),
    (83, 'after', '''setPermissionModeChangedListener：注册权限模式变更监听器，由 print.ts 接线以向 CCR/IDE 实时广播模式切换。'''),
    (90, 'after', '''getSessionState：返回当前会话状态。'''),
    (134, 'after', '''notifySessionStateChanged：更新状态并广播；把 pending_action 镜像进 external_metadata，在 idle 时清空 task_summary，并按环境变量把 idle/running 事件入 SDK 事件队列。'''),
    (140, 'after', '''notifySessionMetadataChanged：把外部元数据变更广播给已注册监听器。'''),
    (150, 'after', '''notifyPermissionModeChanged：权限模式变更的统一出口，确保任何修改路径都无法绕过下游监听。'''),
]
