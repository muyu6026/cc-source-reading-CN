# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  UserToolResultMessage/ 子目录：工具结果的四种结局
// ═══════════════════════════════════════════════════════════════
//
//  一个工具调用跑完之后，屏幕上看到的那个「结果」有四种：
//
//      取消（用户按了 Esc）      → UserToolCanceledMessage
//      拒绝（用户在权限框点了 No）→ UserToolRejectMessage
//      出错（工具自己报错）       → UserToolErrorMessage
//      成功                       → UserToolSuccessMessage
//
//  这四者的区别不在数据层（都是 tool_result），而在**内容里的标记**：
//
//      CANCEL_MESSAGE                     取消
//      REJECT_MESSAGE / 中断文案           拒绝
//      param.is_error                     出错
//      其它                                成功
//
//  也就是又一次「消息即协议」：结局是编码在文本里的。
//
//  这也是整个消息体系里唯一一个「按结局分流」的地方，
//  因为只有工具结果需要区分这四种 —— 别的消息要么成功要么失败，没有中间态。'''),

    (36, 'before', '''// 【先找工具，找不到直接不画】
//
//  useGetToolFromMessages 同时返回 tool 和 toolUse（那次调用的原始参数），
//  两者都必须有。如果只找到 tool 没找到 toolUse，说明 this result
//  对应的是一次**不存在的调用** —— 数据损坏，什么都不画。
//
//  为什么找不到工具就不画，而不是显示「[未知工具的结果]」？
//  因为工具结果的内容格式完全由工具决定，通用渲染器根本没法处理
//  （它可能是 JSON、可能是 ANSI、可能是图片引用）。
//  **宁可空白，也不要给出一段看不懂的原始数据。**'''),

    (40, 'before', '''// 【取消判断：`content.startsWith(CANCEL_MESSAGE)`】
//
//  注意是 startsWith 而不是 ===：因为取消消息后面可能还跟着一些补充说明。
//
//  这里还有一个类型细节：先判 `typeof param.content === 'string'`。
//  因为 tool_result 的 content 可以是 ContentBlock 数组（多模态结果），
//  不是字符串时 startsWith 会抛错。
//
//  第 50 行那个条件里，`typeof … === 'string' && startsWith(...) || … === INTERRUPT`
//  靠的是运算符优先级（&& 高于 ||），等价于
//  `(是字符串且以 REJECT 开头) || (正好等于中断文案)`。
//  写作者没有加括号，读的人要自己补上 —— 这是产物里常见的可读性损失。'''),

    (50, 'before', '''// 【拒绝分两种，走同一个渲染器】
//
//      REJECT_MESSAGE             用户在权限框点了 No
//      INTERRUPT_MESSAGE_FOR_TOOL_USE   用户中途按了 Esc（工具已经开跑）
//
//  两者在界面上都是「Tool use rejected」，但语义不同：
//  一个是「没让你跑」，一个是「跑到一半被我停了」。
//
//  为什么还合并？因为对用户来说都是「这个操作没执行完」，
//  而且 UserToolRejectMessage 的渲染依赖工具（不同工具的拒绝提示不一样），
//  分成两个渲染器会让那个文件再复制一份。
//
//  **把「语义不同但展示相同」的东西合并，是 UI 层常做的简化** ——
//  代价是将来要区分它们时，得再加一个参数。'''),

    (71, 'before', '''// 【is_error 优先于一切成功路径 —— 但它排在取消/拒绝之后】
//
//  这个顺序不是随便定的：
//
//      取消   用户主动操作，最高优先级（他按了 Esc，就该看到「已中断」）
//      拒绝   用户主动操作，次之
//      出错   系统结果
//      成功   系统结果
//
//  如果 is_error 排在取消之前，那么「用户按 Esc 导致的中断」会被显示成
//  「工具报错」—— 用户会以为是自己做错了什么。
//
//  这是**归因顺序**：先归因到人的操作，再归因到系统的结果。'''),

    (88, 'before', '''// 【成功路径参数最多：九个 prop】
//
//  message / lookups / toolUseID / progressMessagesForMessage / style /
//  tool / tools / verbose / width / isTranscriptMode
//
//  为什么传 message 和 toolUseID 两个？因为它们服务于不同的查找：
//      toolUseID   → 在 lookups 里查这次调用的输入
//      message     → 拿 toolUseResult（未解析的原始结果）
//
//  第 88 行的缓存条件里正好列了 10 个（$[17]-$[26]）——
//  和它读到的 prop 数量一致。因为下游组件的每一个 prop 都可能变，
//  少列一个就会出现「看起来没变其实变了」的陈旧画面。
//
//  对比上面三个分支：取消分支的键是 0 个（纯静态，用 sentinel），
//  拒绝分支 8 个，出错分支 6 个。
//  **键的数量 = 这段 JSX 真正读到的东西的数量**，不多不少。'''),
]
