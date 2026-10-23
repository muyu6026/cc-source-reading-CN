ANNOTATIONS = [
    (14, 'before', r'''renderToolUseMessage 返回 null——与 EnterPlanModeTool 对称：审批对话框本身就是 UI，不需要额外的进行态。'''),
    (17, 'before', r'''结果消息三态分流：空计划（一行「Exited plan mode」）/ 等队长审批（显示计划文件路径 + 等待语）/ 正常（用户批准语 + Markdown 渲染计划全文）。'''),
    (31, 'before', r'''空计划态刻意简化：没有计划可展示时连 MessageResponse 容器都不挂——空计划的批准是「放你走了」而非「按此执行」，UI 不能制造不存在的仪式感。'''),
    (41, 'before', r'''等待队长态：文案主语是队友视角（Plan submitted for team lead approval），与本地批准态区分——同一个工具在团队协作里是异步消息，不是同步对话框。'''),
    (55, 'before', r'''正常态：Markdown 渲染计划全文 + 「/plan to edit」提示——计划文件是会话内可持续编辑的一等公民，不是一次性快照。'''),
    (68, 'before', r'''拒绝态复用 RejectedPlanMessage 组件（用户工具结果消息体系），计划内容从 getPlan() 现取——被拒时用户看到的正是他刚刚否掉的那份计划，便于直接在旁边改。'''),
]
