# -*- coding: utf-8 -*-
# 批注数据：source/src/services/PromptSuggestion/promptSuggestion.ts
# 锚点行号指 source/ 原文；中文翻译插在对应英文行之后（或整段注释之后）。
# 不写反斜杠。

ANNOTATIONS = [
    # 变体 + 当前 abort 句柄
    (35, 'after', '模块级 abort 句柄 currentAbortController 串起整条生成链路；getPromptVariant 当前只有一个变体 user_intent——「猜用户自己会敲什么」，而不是「猜模型该做什么」。'),

    # shouldEnablePromptSuggestion
    (94, 'after', '多级开关判定，优先级从高到低：环境变量（测试用）> GrowthBook 远程开关 tengu_chomp_inflection > 非交互会话（打印/管道/SDK 一律关）> 多智能体队友（只让 leader 显示）> 用户设置项。每一级都打 tengu_prompt_suggestion_init 日志记 source，便于事后看「为什么没出现建议」。'),

    # abortPromptSuggestion
    (101, 'after', 'abortPromptSuggestion：用户开始打字或切换上下文时调用，打断正在进行的建议生成，避免过期建议弹出。'),

    # getSuggestionSuppressReason
    (119, 'after', '运行期抑制原因：开关关了 / 正在等权限弹窗 / 有 elicitation 待回答 / 处于 plan 模式 / 外部用户且触发限流——任一命中就先不生成，主路径与流水线路径共用这份判据。'),

    # tryGenerateSuggestion
    (182, 'after', '生成前的多道闸门：已被 abort / 对话太短（少于 2 个 assistant 轮次，没上下文可猜）/ 上一条是 API 报错 / 父消息「缓存冷」/ 运行期被抑制——任一挡住就记 suppressed 返回 null，不浪费一次模型调用。'),

    # executePromptSuggestion
    (237, 'after', 'CLI TUI 入口：只在主线程 REPL 触发；生成成功后写进 AppState.promptSuggestion 让 UI 弹建议；若投机功能开启，紧接着用这条建议启动 startSpeculation——建议与投机是上下游关系。'),

    # getParentCacheSuppressReason
    (256, 'after', '父消息 token 预算 MAX_PARENT_UNCACHED_TOKENS=10,000：把 input + cache_creation + output 加起来，超过就说「缓存冷」不投机。因为 fork 要重新处理父消息的输出，父消息太大时投机成本盖过收益。'),

    # SUGGESTION_PROMPT + SUGGESTION_PROMPTS
    (292, 'after', '预测「用户会自然敲什么」的提示词：核心原则是「他们刚要敲的那句」，不是「模型觉得该做什么」。给了一堆反例——禁止评价性（looks good）、提问、模型口吻（Let me…）、新点子；格式限制 2-12 词，否则就沉默。SUGGESTION_PROMPTS 按变体存，目前两种变体共用同一份。'),

    # generateSuggestion
    (352, 'after', 'fork 子代理猜下一句：canUseTool 直接全部 deny（猜文字不需要工具），从结果里取第一个 assistant 文本块当建议；同时抓第一条 assistant 的 requestId 供强化学习数据集关联。'),

    # 缓存安全覆写说明（多行 // 注释 → after_block）
    (318, 'after_block', '缓存安全铁律：fork 绝不改任何会破坏 prompt 缓存的 API 参数。它靠发「和主线程一模一样的 cache key 参数」蹭主线程的缓存。教训来自 PR #18143——曾给 fork 设 effort:low，导致缓存写入暴涨 45 倍、命中率从 92.7% 跌到 61%。唯一安全的覆写是 abortController / skipTranscript / skipCacheWrite / canUseTool 这些「不进缓存键」的客户端侧参数。'),

    # shouldFilterSuggestion
    (456, 'after', '一堆输出过滤器：剔除「看起来不像用户会敲」的结果——done / 元文本（nothing found、silence 等）/ 括号包裹的元推理 / 报错串 / 带前缀标签 / 词数太少（除非是 / 命令或 yes/commit 等白名单单词）/ 词数太多 / 超长 / 多句 / 含格式符 / 评价性语气 / 模型口吻。每命中一条都记 suppressed 并带上原因。'),

    # logSuggestionOutcome
    (497, 'after', 'SDK 推送路径的结局记录：用户下一条输入到来时，比对是否与建议完全一致判 accepted/ignored，记省时（accept）或忽略耗时，算一个粗相似度；内部用户额外把建议原文与用户输入也记进去（外部不记，守隐私）。'),

    # logSuggestionSuppressed
    (523, 'after', '抑制记录收口：所有「为什么没生成建议」的原因（aborted/early_conversation/cache_cold/plan_mode 等）统一从这一个入口打 tengu_prompt_suggestion 事件（outcome=suppressed），便于统计各类抑制占比。'),
]
