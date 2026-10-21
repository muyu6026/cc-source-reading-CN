# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  HookProgressMessage：hook 正在跑的时候那一行「Running …」
// ═══════════════════════════════════════════════════════════════
//
//  这个文件的核心是第 37-77 行那个分支，它解决了一个很小但很真实的问题：
//
//    transcript 模式（Ctrl+O 全历史）下，消息**永不重渲染**。
//    而「Running PreToolUse hooks…」这种文案是给「正在发生」准备的，
//    一旦它被冻结在一个不再更新的视图里，就会永远显示「正在跑」——
//    哪怕那件事三个小时前就结束了。
//
//  解法是在 transcript 模式里换成过去时（"3 PreToolUse hooks ran"）。
//  一句话：**同一个组件在只读视图里必须给一个不会说谎的文案。**
//
//  这和上一批 Messages.tsx 里 `shouldRenderStatically` 那条不变量是同一个道理：
//  静态渲染的前提是「内容不再变」，所以任何「表达正在发生」的文案都得准备静态版本。'''),

    (23, 'before', '''// 【两级 Map 查找：toolUseID → hookEvent → 计数】
//
//  `lookups.inProgressHookCounts.get(toolUseID)?.get(hookEvent) ?? 0`
//
//  lookups 是 Messages.tsx 一次性预算出来的（buildMessageLookups），
//  所有渲染器共享。这样每个组件不必自己去遍历全部消息。
//
//  注意 `?.` 和 `?? 0` 连着用：第一层可能没有这个 toolUseID，
//  第二层可能没有这个 hookEvent，两次缺席都折成 0。
//  于是下游的 `if (inProgressHookCount === 0) return null` 就成立了。'''),

    (33, 'before', '''// 【resolvedHookCount 没有缓存槽，而 inProgressHookCount 有】
//
//  差别在于用途：
//    · inProgressHookCount  要拼进 JSX（进槽）
//    · resolvedHookCount    只参与第 78 行的一次相等比较（不进槽）
//
//  这不是 Compiler 的随机行为，而是一条可预测的规则：
//  **值被 JSX 或下游 memo 用到 → 建槽；只在一次判断里用 → 每次重算。**
//
//  所以读产物时，可以直接用「有没有槽」反推「这个值后来被谁用了」，
//  比顺着代码往下找更快。'''),

    (38, 'before', '''// 【PreToolUse / PostToolUse 是「每个工具都会跑」的两种 hook，所以特殊对待】
//
//  其它 hook 事件（SessionStart、Stop…）在折叠行里显示成
//  「Running XML hook…」；而 Pre/PostToolUse 在每个工具调用上都可能触发，
//  数量多、要合并成一条摘要，所以单独走一条路。
//
//  这也是为什么 AssistantToolUseMessage 里会**单独**渲染一个
//  `<HookProgressMessage hookEvent="PreToolUse" …>`（见那个文件第 351 行），
//  而不是把它混进工具自己的进度消息里。'''),

    (78, 'before', '''// 【`resolvedHookCount === inProgressHookCount` 就返回 null】
//
//  含义是：这一批 hook 全部有结果了，就没有必要再显示「正在跑」。
//  注意它比较的是**数量相等**，不是「inProgress 为 0」——
//  因为在流式过程中，inProgress 可能一直是 3，同时 resolved 也涨到 3。
//
//  用相等比较而不是「大于等于」，是在假设「resolved 不会超过 inProgress」。
//  这个假设由上游（计数逻辑）保证，渲染层不再重复校验。'''),

    (96, 'before', '''// 【单复数用 `\u2026` 直接拼在字符串里】
//
//      const t4 = inProgressHookCount === 1 ? " hook" : " hooks"
//
//  注意这里连前面的空格一起放进字符串（" hook" / " hooks"），
//  是为了让 JSX 里不用再写 {' '}。在终端里，JSX 中相邻文本节点的空白
//  会被 Ink 保留，但显式写在字符串里更稳。
//
//  这个目录里两种写法都有（`{' '}` 和 " "），没有统一。
//  改动时按所在文件已有风格走，不要为了「一致」去动别处。'''),
]
