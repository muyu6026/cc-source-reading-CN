# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  tools/toolExecution：一次工具调用的完整生命周期（1,745 行）
// ═══════════════════════════════════════════════════════════════
//
//  这是工具系统的中枢。一次调用要过九道关：
//
//      1. 找到工具（含废弃别名回退）          第 345 行
//      2. 找不到 → 吐一条 tool_result 错误     第 369 行
//      3. 检查是否已被中止                    第 415 行
//      4. zod 校验输入                        第 615 行
//      5. 解析结果 → PreToolUse 钩子           runPreToolUseHooks
//      6. 钩子裁决 → 权限决定                  resolveHookPermissionDecision
//      7. 权限弹窗（canUseTool）
//      8. 真正执行，边跑边吐进度
//      9. PostToolUse / 失败钩子 + 落历史
//
//  注意第 2 步和第 4 步：**校验失败也是「一条 tool_result」**，不是抛错。
//  因为协议要求每个 tool_use 都必须有配对的结果，缺一个下一次请求就 400。'''),

    (133, 'before', '''// 【两个阈值，单位都是毫秒，但用途完全不同】
//
//      HOOK_TIMING_DISPLAY_THRESHOLD_MS = 500     超过就在界面上显示耗时
//      SLOW_PHASE_LOG_THRESHOLD_MS = 2000         超过就写一条调试警告
//
//  两个数都不是随手取的，注释给了依据：
//
//      500ms  →  低于这个看不到，显示了反而占地方
//      2000ms →  和 BashTool 的 PROGRESS_THRESHOLD_MS 对齐，因为
//                「折叠视图超过这个时长会让人以为卡死了」
//
//  注意后一条的理由是**用户体验**（felt stuck），不是技术指标。
//  这是很少见的写法：注释直接说「用户会觉得卡」，而不是「性能不佳」。
//
//  判据：阈值宁可抄同一套数字，也不要各自拍脑袋 —— 对齐才有可解释性。'''),

    (139, 'before', '''// 【classifyToolError：为什么要自己做错误分类，而不是用 constructor.name】
//
//  注释给了直接原因：
//
//      In minified/external builds, error.constructor.name is mangled into
//      short identifiers like "nJT" or "Chq" — useless for diagnostics.
//
//  压缩之后类名变成三字母乱码。所以在生产环境里，`error.constructor.name`
//  这条路是**完全不可用的** —— 而开发环境里它工作得很好，这就是它一直
//  没被发现的原因。
//
//  四级兜底，按可靠性排序：
//
//      1. TelemetrySafeError  专门设计的错误类，自带可上报的 message
//      2. errno 的 code       ENOENT / EACCES，稳定且有用
//      3. error.name          只有长度 > 3 才用（因为压缩后通常很短）
//      4. 'Error'
//
//  第 3 条那个 `length > 3` 就是在过滤压缩产物：真类名（ShellError）
//  比 3 长，乱码（nJT）不超过 3。
//
//  **这是一个「如何在压缩后仍能诊断」的具体方案**，值得抄。'''),

    (264, 'before', '''// 【MessageUpdateLazy：名字里的 Lazy 是关键字】
//
//  它允许 `newContext` 可选 —— 也就是「这次更新只有消息、没有上下文变化」。
//  和 toolOrchestration 里的 MessageUpdate 区别在于：那里 newContext 必填，
//  因为串行执行时每个更新都要带上下文。
//
//  为什么需要两种类型？因为流式执行时，进度消息是一条一条吐的，而上下文
//  只在工具真正完成时才变。**如果格式统一成「每条消息都带上下文」，
//  调用方就分不清「上下文真的没变」和「这次只是进度」。**
//
//  用类型表达「这次有没有上下文变化」，比传一个 null 再判断更明确。'''),

    (337, 'before', '''// 【runToolUse：整个生命周期的入口，先做三件不涉及执行的事】
//
//  1. 找工具（第 345 行）
//  2. 找 MCP 元信息（第 359 行）—— 给埋点用的服务器类型和 baseUrl
//  3. 找不到就吐错误结果并 return（第 369 行）
//
//  第 2 步值得注意：它在「还不知道工具能不能用」的时候就查了 MCP 信息。
//  因为后面每一条埋点都要带这两个字段（成功、失败、取消都要），
//  与其每处都查，不如入口查一次。
//
//  **把「所有出口都要用的元信息」提到入口统一收集**，是这个函数的
//  组织原则 —— 你会在后面看到几个 logEvent 里都带着同样的 mcpServerType。'''),

    (347, 'before', '''  // 【找不到工具时，还要回退查一次「废弃别名」】
  //
  //  场景：旧会话记录里模型调用的是 KillShell，而这个工具现在改名成 TaskStop，
  //  KillShell 变成了它的 alias。用 --resume 恢复旧会话时，历史里的
  //  tool_use.name 还是老名字。
  //
  //  回退逻辑有一个很克制的限制（第 353 行）：
  //
  //      if (fallbackTool && fallbackTool.aliases?.includes(toolName)) tool = fallbackTool
  //
  //  也就是**只有当这个名字确实是某个工具的别名时才回退**。不是「全局搜一遍
  //  名字相近的」—— 那样会把模型的拼写错误也悄悄修好，掩盖真实问题。
  //
  //  这是一条很值得学的边界：**兼容旧数据，但不纵容新错误。**'''),

    (415, 'before', '''    // 【第一件事是检查已经中止 —— 而且中止也要产出一条结果】
    //
    //  注意这里在 try 里面（第 414 行），而且中止分支同样 logEvent +
    //  yield 一条消息。为什么不能直接 return？
    //
    //  因为协议：tool_use 必须有配对的 tool_result。如果中止时什么都不吐，
    //  消息序列里就会出现一个悬空的 tool_use，下一次请求直接 400。
    //
    //  **「取消」在协议层不是「什么都没发生」，而是「发生了一件叫取消的事」。**
    //  这个区别是很多实现会踩的坑：逻辑上取消了，协议上却留下了空洞。'''),

    (492, 'before', '''// 【streamedCheckPermissionsAndCallTool：一个「流式版本」的包装】
//
//  同目录里有两个入口（第 492 行和第 599 行），差别只有一点：
//
//      流式版本     工具参数还在流式接收，可以提前开始权限检查
//      普通版本     参数已经完整，直接走检查
//
//  这类「为了提前一点而复制一条路径」的写法要小心，但这里是有理由的：
//  权限检查是**唯一可能长时间阻塞**的环节（要等用户点确认），
//  所以提早开始它能省掉真实的等待时间。
//
//  代价是两条路径必须保持语义一致 —— 这就是为什么权限裁决的核心逻辑
//  被抽到了 resolveHookPermissionDecision（toolHooks.ts），两个入口共用。
//  **复制流程可以，复制语义不行。**'''),

    (578, 'before', '''// 【buildSchemaNotSentHint：一条错误提示是怎么变长的】
//
//  这个函数只在一种情况被调用：工具输入校验失败，而且那个工具的 schema
//  因为「延迟加载」没被发进 prompt。
//
//  它返回的提示不只是一句「你参数错了」，而是把**因果链和支持的操作**都写全了：
//
//      This tool's schema was not sent to the API — it was not in the
//      discovered-tool set derived from message history.
//      Without the schema in your prompt, typed parameters (arrays, numbers,
//      booleans) get emitted as strings and the client-side parser rejects them.
//      Load the tool first: call ToolSearch with query "select:<name>", then retry.
//
//  三段结构值得学：**现象 → 原因 → 下一步动作。**
//  特别是第二段：它解释了一个模型很难自己想到的事（没有 schema 时
//  它会把数组写成字符串），这直接决定了模型能不能改对。
//
//  第 583 行那段注释还承认了这是「乐观判断」：
//
//      Optimistic gating — reconstructing claude.ts's full useToolSearch
//      computation is fragile. ... occasional misfires cost one extra
//      round-trip on an already-failing path.
//
//  也就是它可能误判，但误判的代价只是「已经在失败的路上多一次往返」——
//  所以敢用简化判断。**这是「失败路径上的优化不必完美」的典型论证。**'''),

    (614, 'before', '''  // 【第 614 行这行注释是一句大实话】
  //
  //      // Validate input types with zod (surprisingly, the model is not great
  //      // at generating valid input)
  //
  //  「出乎意料，模型不太会生成合法输入」—— 所以校验是必须的，
  //  而且失败是**常态**，不是异常。
  //
  //  因此校验失败的处理非常讲究（第 616 行起）：
  //
  //      1. 把 zod 的错误格式化成「人/模型能看懂」的句子
  //      2. 如果是因为 schema 没发，追加上面那个三段式提示
  //      3. 埋点（tengu_deferred_tool_schema_not_sent）
  //      4. 返回一条 tool_result（is_error: true），不抛错
  //
  //  这就是「校验失败」和「系统错误」的区别：前者是可预期的业务流程，
  //  要给出可行动的提示；后者才是异常。
  //
  //  判据：**如果一个错误是常态，它就不该走异常通道。**'''),
]
