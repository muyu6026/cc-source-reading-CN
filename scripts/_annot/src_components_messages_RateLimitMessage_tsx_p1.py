# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  RateLimitMessage：限流时那句话 + 一句「你还能做什么」
// ═══════════════════════════════════════════════════════════════
//
//  这个文件分两半：
//      getUpsellMessage   纯函数，六个布尔进、一句话出（第 18-47 行）
//      RateLimitMessage   组件，把这句话和限流原因画出来
//
//  纯函数那一半是这个文件的价值所在：**把「用户该看到哪句话」的所有分支
//  收在一个没有 React 的函数里**，可以单独测、单独读。
//
//  组件那一半反而很薄 —— 它只负责取数、计时、拼装。'''),

    (18, 'before', '''// 【六个参数，六个分支，覆盖「谁在限流、还能不能自救」】
//
//  按顺序读，其实是在回答三个问题：
//
//    1. 要不要显示建议？            !shouldShowUpsell → null
//    2. 你是 Max 20x 吗？           → 走额外用量 / 换 API 账号
//    3. 菜单已经自动弹了吗？         → 弹了就只说「正在打开选项…」
//
//  然后是团队/企业分支（要管理员批额度），最后是普通用户（/upgrade 或 /extra-usage）。
//
//  六个布尔里有三个来自**全局身份**（订阅类型、限流档位、账单权限），
//  两个来自**当前状态**（是否已弹菜单、是否真的在限流）。
//
//  把它们并列成一个参数对象，是为了让调用点显式看到「这句话依赖什么」——
//  如果参数只有两个，读代码的人会以为逻辑简单。'''),

    (36, 'before', '''// 【`!isTeamOrEnterprise && !isExtraUsageCommandEnabled` 两个否定连用】
//
//  含义是：普通用户，而且这个构建里**没有** /extra-usage 命令 ——
//  那就只能提示 /upgrade，因为没有第二条路可走。
//
//  如果那个命令存在，就落到第 46 行，给出「两条路」的文案。
//
//  这里体现的是**按可用性裁剪文案**：同一类用户，在不同构建/地区/套餐下
//  能用的命令不一样，文案要跟着变。写死「/upgrade 或 /extra-usage」
//  在有用户点不到 /extra-usage 时会变成误导。'''),

    (59, 'before', '''// 【三个全局值都用 sentinel 缓存 —— 意味着它们**只在挂载时读一次**】
//
//      getSubscriptionType()      订阅类型
//      getRateLimitTier()         限流档位
//      shouldProcessMockLimits() || isClaudeAISubscriber()   要不要显示建议
//
//  这三样在进程生命周期里都不会变（改订阅要重启），所以缓存是安全的，
//  而且省掉了每次渲染三次全局读。
//
//  但这对第 112 行有一个连带影响：
//
//      if ($[7] !== shouldAutoOpenRateLimitOptionsMenu) {
//        t7 = getUpsellMessage({ shouldShowUpsell, isMax20x, ... extraUsage.isEnabled(), ... })
//      }
//
//  **getUpsellMessage 的缓存键只有 shouldAutoOpenRateLimitOptionsMenu 一个。**
//  因为它读到的其它值全是从 sentinel 槽里取出来的常量。
//
//  于是 `extraUsage.isEnabled()` 和 `hasClaudeAiBillingAccess()` 也变成了
//  「只在挂载时算一次」—— 这是缓存传播的**隐式后果**，
//  写代码的人未必意识到，但结果是对的（它们也可视为进程级常量）。'''),

    (85, 'before', '''// 【`hasOpenedInteractiveMenu` 是一个「本次会话只弹一次」的闸】
//
//  它和第 88 行的 shouldAutoOpenRateLimitOptionsMenu 一起构成：
//
//      应该自动打开 && 还没打开过 && 确实在限流 && 有回调
//          → 下面那个 useEffect 会真的调 onOpenRateLimitOptions()
//
//  打开之后 setHasOpenedInteractiveMenu(true)，条件永久为假。
//
//  注意第 149 行还用它做了一个显示判断：`hasOpenedInteractiveMenu ? null : upsell`。
//  也就是说「菜单弹过了，就别再提示 /upgrade 了」——
//  因为用户已经看到真正的选项菜单，再叠一句文字是重复信息。
//
//  **一个状态同时服务于「副作用只跑一次」和「文案不再显示」两个目的。**
//  这在本批里是唯一一处，但它是一个常见模式：一次性动作的 flag 往往兼任显示开关。'''),

    (107, 'before', '''// 【`useEffect(t4, t5)` —— 函数和依赖数组都是从缓存槽里取的】
//
//  t4 是那个回调，t5 是 `[shouldAutoOpenRateLimitOptionsMenu, onOpenRateLimitOptions]`。
//  两者都是同一个 `if ($[3] !== ... || $[4] !== ...)` 块算出来的。
//
//  这就是产物里最容易被误读的一处：**依赖数组也是被缓存的对象**。
//  它不再是源码里那句字面量，而是一个变量。
//
//  上一批 PromptInput 的 SandboxPromptFooterHint 就是栽在这里：
//  编译后的 `t1 = []` 被缓存在槽里，于是「依赖数组」变成一个
//  永不变化的常量数组 —— 语义上等于 `useEffect(..., [])`。
//  那一处的后果是「沙箱中途打开不计数」。
//
//  这里没有那个问题，因为数组里两项都在缓存键里，
//  条件变了数组就重建。**判断有没有 bug，要看键里有没有那两个变量。**'''),
]
