# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (11, 'before', '进入计划模式的权限弹窗：Claude 请求从执行模式切到 plan 模式做探索与方案设计。与其他权限弹窗一样接 PermissionRequestProps，多一个 workerBadge（子代理徽标）。'),
    (19, 'before', '从全局应用状态读当前权限模式：进入 plan 前要记住「从哪个模式来」，批准计划的返回才会切回去。选择器函数被提取为文件尾的 _temp。'),
    (22, 'before', 'handleResponse 是弹窗的全部业务：yes 走批准三连，no 走拒绝三连。函数记忆化依赖四个闭包变量。'),
    (24, 'before', '打点：记录进入计划模式事件与入口方式（tool 表示由工具请求触发，区别于用户主动 shift+tab 切换）；是否启用访谈阶段也一并上报，供 A/B 分析。'),
    (28, 'before', '同步 bootstrap 全局状态到 plan 模式——这改的是应用级状态，第 30 行的 setMode 指令改的是权限上下文，两处都要改。'),
    (30, 'before', 'onAllow 的第二参数是副作用指令数组：批准工具调用的同时附带一条 setMode 指令，把权限上下文的模式切到 plan 并持久化到 session 级。「批准一个动作」与「切换一个模式」用同一机制表达。'),
    (36, 'before', '拒绝三连：onDone 关弹窗、onReject 通知权限系统、onReject 通知工具调用方。三个回调各管一层，缺一会出现弹窗关了但工具还在等的悬挂。'),
    (52, 'before', '提示文案分三段且全部进常量槽：说明句、plan 模式会做的四件事（探索代码、识别既有模式、设计策略、提交计划供批准）、承诺句。静态文案只建一次，动态部分只有 Select 的 onChange。'),
    (66, 'before', '承诺句单独一段：批准计划前不会改任何代码——这是 plan 模式的核心承诺，文案上与上面的动作列表隔开。'),
    (83, 'before', '选项数组：两选项均为字面量常量进槽。第二项文案是 No, start implementing now——拒绝即按原模式直接执行原请求。'),
    (101, 'before', '主体容器：三段文案加 Select。onCancel 映射为 handleResponse 加 no——Esc 等价于点第二项。'),
    (110, 'before', 'PermissionDialog color 为 planMode：计划模式弹窗有专属配色，视觉上与普通权限弹窗区分。workerBadge 原样透传。'),
]
