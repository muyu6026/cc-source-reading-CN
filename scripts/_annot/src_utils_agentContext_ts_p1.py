# 批注数据：src/utils/agentContext.ts

ANNOTATIONS = [
    (1, 'after', '''本文件用 AsyncLocalStorage 跟踪智能体身份，避免参数层层透传；
支持子智能体（Agent 工具）与进程内队友（集群）两类，跨并发异步链互不干扰。'''),
    (28, 'after', '''SubagentContext 描述子智能体上下文：UUID、父会话编号、类型名、是否内置、调用请求编号等。'''),
    (56, 'after', '''TeammateAgentContext 描述集群队友上下文：完整代理编号、显示名、队名、颜色、是否队长等。'''),
    (87, 'after', '''AgentContext 是两类上下文的判别联合，用 agentType 区分。'''),
    (93, 'after', '''用 AsyncLocalStorage 存放当前智能体上下文，使同一进程内并发后台智能体不会互相覆盖。'''),
    (95, 'after', '''getAgentContext 读取当前上下文，不在任何智能体上下文中时返回 undefined。'''),
    (104, 'after', '''runWithAgentContext 在给定上下文下运行函数，内部所有异步操作都能取到该上下文。'''),
    (112, 'after', '''isSubagentContext 是类型守卫，收窄上下文是否为子智能体。'''),
    (121, 'after', '''isTeammateAgentContext 是类型守卫：仅在集群启用时认定 teammate，否则恒为假。'''),
    (133, 'after', '''getSubagentLogName 取适合分析日志的子智能体名：内置用类型名，自定义统一映射为字面量 user-defined。'''),
    (153, 'after', '''consumeInvokingRequestId 每次 spawn 或 resume 后只取一次调用请求编号，标记边界后返回。'''),
    (178, 'after', '''consumeInvokingRequestId 收尾：主线程或没有请求编号时返回 undefined，避免重复上报。'''),
]
