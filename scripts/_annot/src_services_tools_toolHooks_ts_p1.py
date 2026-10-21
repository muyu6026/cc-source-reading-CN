# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  tools/toolHooks：工具执行前后的钩子编排（650 行）
// ═══════════════════════════════════════════════════════════════
//
//  四个出口，正好是钩子的四种时机：
//
//      runPreToolUseHooks             工具跑之前（可以拦、可以改参数）
//      runPostToolUseHooks            成功后（可以看输出、可以改输出）
//      runPostToolUseFailureHooks     失败后（可以观察、可以注入提示）
//      resolveHookPermissionDecision  把钩子的裁决翻译成权限决定
//
//  最后那个函数是本文件的精华 —— 它守着一句很容易被误解的规则：
//  **钩子说 allow，不等于绕过 settings.json 里的 deny。**'''),

    (35, 'before', '''// 【返回类型是一个联合，两种结果混在一个流里】
//
//      MessageUpdateLazy<AttachmentMessage | ProgressMessage<HookProgress>>
//    | { updatedMCPToolOutput: Output }
//
//  前一种是「吐给 UI 的消息」（钩子输出、进度、错误附件），
//  后一种是「钩子把工具的输出改了」。
//
//  为什么用 AsyncGenerator 而不是返回数组？因为钩子可能跑很久
//  （用户配了个脚本），要边跑边显示进度。**用一个流同时承载「消息」和
//  「控制信号」**，是这套代码的惯用手法 —— 消费方靠字段存在与否分流。'''),

    (90, 'before', '''// 【这段注释在解释一个「重复显示」的 bug（#31301）】
//
//  原文：
//
//      For JSON {decision:"block"} hooks, executeHooks yields two results:
//      {blockingError} and {message: hook_blocking_error attachment}. The
//      blockingError path below creates that same attachment, so skip it here
//      to avoid displaying the block reason twice (#31301).
//      The exit-code-2 path only yields {blockingError}, so it's unaffected.
//
//  拆开看：钩子拦下工具调用有两条路 ——
//
//      JSON 输出 {decision:"block"}   →  产出两条结果（一个 error + 一个附件）
//      退出码 2                        →  只产出一条（error）
//
//  下面那段代码会给「有 error」的情况**自己造一个附件**。于是 JSON 那条路
//  就变成了「自己造的 + 上游给的」两份，用户看到同一句话两遍。
//
//  修法是「在这里跳过上游那份」。而这个修法的脆弱之处注释也交代了：
//  它依赖「哪条路会多吐一条」这个细节，将来上游改了产出结构就会再生。
//
//  **读这类代码要有意识：这是一个 patch，不是一个设计。**'''),

    (321, 'before', '''// 【resolveHookPermissionDecision 的 JSDoc 里藏着一句硬规则】
//
//  原文：Encapsulates the invariant that hook 'allow' does NOT bypass
//  settings.json deny/ask rules — checkRuleBasedPermissions still applies
//  (inc-4788 analog).
//
//  也就是说：**钩子说「允许」，不能推翻用户在设置文件里写的「禁止」。**
//
//  为什么？因为钩子是「自动化」，而 settings.json 是「人的意志」。
//  自动化不该覆盖人明确写下的拒绝。如果钩子能绕过 deny，那么一个
//  被恶意篡改的钩子脚本就能让所有危险命令通行 —— 而用户以为自己
//  已经禁掉了。
//
//  所以顺序是：
//
//      钩子 allow  →  仍然跑一遍 checkRuleBasedPermissions
//      规则 deny   →  拒绝（钩子说什么都没用）
//      规则 allow  →  放行
//      规则 null   →  继续（走交互提示）
//
//  注释还说明这个函数被两处共用（主循环 + REPL 内层调用），
//  目的是 so the permission semantics stay in lockstep —— **同一套语义
//  只能有一份实现，否则两条路径迟早会不一致。**'''),

    (350, 'before', '''    // 【interactionSatisfied：一个很聪明的特例】
    //
    //  原注释：Hook provided updatedInput for an interactive tool — the hook
    //  IS the user interaction (e.g. headless wrapper that collected
    //  AskUserQuestion answers). Treat as non-interactive for the rule-check path.
    //
    //  场景：AskUserQuestion 这种工具「需要人回答」。在无头环境里没人能回答，
    //  所以外层包了一个钩子，把答案直接塞进 updatedInput。
    //
    //  这时如果还坚持「需要交互 → 走 canUseTool」，就会卡住等一个永远不会
    //  出现的用户。所以这里的判断是：**钩子给了 updatedInput，就等价于
    //  用户已经回答了。**
    //
    //  注意这个等价不是随便定的 —— 它成立的前提是「钩子有权限代替用户
    //  提供答案」，而这一点由钩子的配置权限保证（用户自己配的钩子）。
    //
    //  **一个特例值不值得写，取决于它背后的信任模型是否成立。**'''),

    (372, 'before', '''    // 【这一行是本函数的核心，也是一句大实话的注解】
    //
    //      // Hook allow skips the interactive prompt, but deny/ask rules still apply.
    //
    //  翻译：钩子允许可以跳过「弹窗问用户」，但设置里的 deny/ask 规则照样生效。
    //
    //  拆开是两个正交的维度：
    //
    //      要不要弹窗          ← 钩子可以说「不用问」
    //      允不允许            ← 规则说了算，钩子无权推翻
    //
    //  很多人会把这两件事混成一件（「钩子允许了就不用检查了」），
    //  而混起来的后果是安全边界被自动化绕过。
    //
    //  这条区分值得记住：**「省掉交互」和「改变策略」是两件不同的事。**'''),
]
