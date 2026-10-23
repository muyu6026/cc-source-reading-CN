ANNOTATIONS = [
    (21, 'before', r'''inputSchema 是空 strictObject——进入计划模式不需要任何参数，模型只需表态「我要开始规划了」。参数越少越难被误用。'''),
    (36, 'before', r'''buildTool 主结构。注意 userFacingName() 返回空串——这个工具对用户完全静默，只在权限对话框与结果消息里露面。'''),
    (56, 'before', r'''isEnabled 的 channels 防护：--channels 模式下退出计划模式的审批对话框没人看得见（用户在 Telegram/Discord 上），于是连「进入」也一并禁用——进得去出不来的计划模式是陷阱，入口必须与出口成对设防。'''),
    (68, 'before', r'''isConcurrencySafe 为真：进入计划模式只改会话状态，不碰磁盘，可与其他工具并行。'''),
    (71, 'before', r'''isReadOnly 为真：规划阶段被框架认定为只读操作，权限链路放行。'''),
    (77, 'before', r'''call() 第一道守卫：agentId 存在即抛错。子代理没有「计划模式」这个概念——它们的生命周期由父级编排，让子代理进入计划模式会造成状态机歧义。'''),
    (82, 'after', r'''handlePlanModeTransition 负责广播模式变更事件（UI 状态栏、hooks 等订阅方据此刷新）。'''),
    (88, 'before', r'''权限上下文两连改：先 prepareContextForPlanMode 跑分类器激活副作用（defaultMode 为 auto 时进入计划模式会临时挂起自动放行），再 applyPermissionUpdate 落 setMode。mode 与 destination: session 绑定，计划模式不跨会话持久化。'''),
    (96, 'before', r'''返回给模型的确认消息。注意 data 里只有一句话——真正的工作指引在下面的 mapToolResultToToolResultBlockParam 里展开。'''),
    (103, 'before', r'''tool_result 内容按 isPlanModeInterviewPhaseEnabled() 分叉：开启访谈阶段时只给一句「除计划文件外不许写任何文件」（详细流程改由 plan_mode attachment 后续送达，避免重复注入）；关闭时给出六步探索清单 + 只读强调。'''),
]
