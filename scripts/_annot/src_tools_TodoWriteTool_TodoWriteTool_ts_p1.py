ANNOTATIONS = [
    (13, 'before', r'''inputSchema 只有一个 todos 字段，结构（三态、双形式 content/activeForm）由 TodoListSchema 在 utils/todo/types.ts 定义——schema 不在工具里重复声明，清单的演进与工具解耦。'''),
    (31, 'before', r'''buildTool 主结构。strict: true 挂顶层——输入输出双重严格。'''),
    (52, 'before', r'''isEnabled 取反：TodoWrite 只在 V1 清单启用时存在。isTodoV2Enabled() 开启时本工具整个消失（任务管理移交给 TaskCreate/TaskUpdate 系列）——工具Availability 跟着功能开关走，而不是让旧工具报错。'''),
    (55, 'before', r'''toAutoClassifierInput：喂给自动权限分类器的摘要只是「N items」——清单操作本身无风险面，分类器只需要知道规模。'''),
    (58, 'before', r'''checkPermissions 无条件 allow：待办清单是会话内私有状态，不碰文件系统，无授权必要。'''),
    (65, 'before', r'''call() 第一行取 appState；todoKey 用 agentId ?? getSessionId()——子代理各持一份独立清单（并行 agent 的进度不能互相污染），主线程用会话 ID。这是多 agent 场景下状态隔离的最小实现。'''),
    (67, 'after', r'''oldTodos 先快照再改——返回值带新旧两份，UI 层可以渲染 diff（哪些项被划掉、哪些新增）。'''),
    (69, 'after', r'''allDone 时 newTodos 置空数组：全部完成的清单不再占据后续上下文——这是「完成即退场」的上下文经济学，清单是工作脚手架不是永久档案。注意 data.newTodos 仍返回原始 todos（遥测/UI 需要看到完整终态），落 state 的才是空数组。'''),
    (77, 'before', r'''verificationNudge：主线程 agent 收尾一个 3+ 项清单、且没有任何一项内容匹配 /verif/i 时，往 tool_result 追加「先去跑验证 agent」的提醒。触发点卡在「最后一项关闭、循环即将退出」的精确时刻——统计上跳步骤就发生在这里。growthbook 开关 + VERIFICATION_AGENT 特性双闸门控制。'''),
    (88, 'before', r'''状态写入：整个 todos map 不可变替换（key 粒度更新）。React/ink 的重渲染靠引用变更触发。'''),
    (104, 'before', r'''tool_result 组装：base 是固定的「清单已更新，继续推进」+ 条件 nudge。nudge 文案措辞强硬——「你不能靠在总结里列 caveats 给自己打 PARTIAL，只有 verifier 能出裁决」——直接把自评漏洞堵死。'''),
]
