# -*- coding: utf-8 -*-
# annotations for src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx (74 lines)
ANNOTATIONS = [
    (18, 'before', '向导确认步的包装层：落盘、状态更新、打点、打开编辑器都在这里，ConfirmStep 只负责展示'),
    (28, 'after', 'saveAgent 是核心流程：saveAgentToFile 落盘，然后更新 AppState 的 agentDefinitions，可选打开编辑器，最后打点并回报消息'),
    (31, 'after', 'saveAgentToFile 按位置传了一长串参数：位置、名字、描述、工具、提示词（这里调用 getSystemPrompt 求值）、是否覆盖、颜色、模型、记忆'),
    (32, 'after', 'setAppState 里再判一次 finalAgent 是否还在：闭包捕获的值可能已过期'),
    (39, 'after', 'activeAgents 由 getActiveAgentsFromList 重算而不是手工追加：启用规则集中在一处'),
    (51, 'after', '打点字段全是布尔与计数，没有文件路径：那个 AnalyticsMetadata 类型就是用来在编译期挡住路径泄漏的'),
    (55, 'after', 'tool_count 用长度或字符串 all：工具全开时没有可数的长度'),
    (64, 'after', '两条完成文案：打开编辑器时额外提醒需要重启才能加载改动'),
    (67, 'after', 'catch 里把错误消息落到 saveError 交给 ConfirmStep 展示，不往上抛'),
    (70, 'after', '两个入口共用 saveAgent：只差一个布尔'),
]
