ANNOTATIONS = [
    (11, 'before', r'''renderCreateToolUseMessage：cron 表达式原样 + prompt 截断 60 字符。表达式是人类可读的调度语言（对比 cronToHuman 的「每周五 9 点」），原样显示让用户能核对自己写的表达式。'''),
    (17, 'before', r'''renderCreateResultMessage：任务 ID 加粗 + 括号内人类可读周期。ID 是后续 CronDelete 的唯一凭据，结果位必须显眼。'''),
    (28, 'before', r'''renderDeleteToolUseMessage：只显示 ID——删除的「使用中」状态就是一行 ID，没有更多信息可展示。'''),
    (43, 'before', r'''renderListToolUseMessage 返回空串——列任务的进行态无内容（瞬时操作），只在结果位出现。'''),
    (46, 'before', r'''renderListResultMessage：空列表灰字「No scheduled jobs」；非空每个任务一行（ID 加粗 + 人类周期）。与 mapToolResult 的纯文本版同构——ink 组件版给 TUI，文本版给 tool_result。'''),
]
