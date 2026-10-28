ANNOTATIONS = [
    (34, 'before', """getParentSessionId：返回作为队友运行时的父会话 ID，优先级为进程内上下文高于动态团队上下文。"""),
    (44, 'after', """dynamicTeamContext：运行时加入团队时设置的动态上下文，优先级高于环境变量，覆盖代理标识与父会话等信息。"""),
    (56, 'before', """setDynamicTeamContext：在运行时加入团队时写入动态上下文。"""),
    (79, 'before', """getDynamicTeamContext：读取当前动态团队上下文，供检查与调试使用。"""),
    (88, 'before', """getAgentId：返回本会话作为队友运行时的代理 ID，否则为独立会话返回 undefined。"""),
    (111, 'before', """getTeamName：返回团队名，优先级为进程内上下文、动态上下文，最后回退到 AppState 传入的团队上下文。"""),
    (125, 'before', """isTeammate：判断本会话是否作为队友运行，tmux 队友需同时具备代理 ID 与团队名。"""),
    (149, 'before', """isPlanModeRequired：判断该队友在实现前是否需要先进入计划模式并获得批准。"""),
    (171, 'before', """isTeamLead：判断本会话是否为团队负责人，兼容早期未标准化代理 ID 的原始创建会话。"""),
    (205, 'before', """hasActiveInProcessTeammates：检查是否有正在运行的进程内队友任务，供无头模式决定退出前是否等待。"""),
    (238, 'before', """waitForTeammatesToBecomeIdle：返回在所有忙碌进程内队友转为空闲时才兑现的 Promise。"""),
]
