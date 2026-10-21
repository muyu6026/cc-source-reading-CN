# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  grove：那个「条款更新了，请你选一下要不要帮我们改进」的弹窗
// ═══════════════════════════════════════════════════════════════
//
//  名字很抽象（Grove），实质是一次**同意管理**：用户必须显式做出一次选择，
//  之后弹窗永久消失。所以这个文件的核心不是「渲染弹窗」，
//  而是「什么情况下该弹、什么情况下绝对不能弹」。
//
//  357 行里，值得读的是三处：
//
//      第 42 行   ApiResult —— 区分「失败」和「成功但字段为空」
//      第 77 行   失败不缓存（否则会把用户锁死在隐私设置外面）
//      第 284 行  calculateShouldShowGrove —— 五个条件的纯函数'''),

    (42, 'before', '''// 【ApiResult：一个比 boolean 多一点点信息的类型】
//
//      { success: true; data: T } | { success: false }
//
//  注意 success: false 那一支**没有 error 字段**。也就是：
//  「失败了」这件事被记录，「为什么失败」被丢弃。
//
//  为什么够用？因为调用方的反应是统一的：失败就不显示弹窗。
//  既然处理方式一样，把错误细节传下去只会诱发「在别处又处理一遍」。
//
//  这和第 16 行那两个字段是配套的：enabled/hasError 是「业务答案 + 可信度」，
//  ApiResult 是「有没有答案 + 答案」。两个类型解决同一个问题的两种粒度。
//
//  对比一下更常见的反例：返回 `T | null` 然后到处 `if (x)`。
//  那样「成功但 data 是 null」和「失败」就没法区分了 ——
//  而这里的 `grove_enabled: boolean | null` 恰好**允许 null 是合法值**
//  （null 表示用户还没选过）。这就是为什么必须用 ApiResult 包一层。'''),

    (52, 'before', '''// 【用 memoize 而不是自己写缓存 —— 但配了一条容易漏的规则】
//
//  函数体里的注释（第 49 行）说 Memoized for the session to avoid redundant
//  per-render requests。也就是说这是**渲染期会被反复调用**的函数，
//  缓存主要是为了让 React 的多次渲染打不到网络上。
//
//  但注意第 81 行那一句：
//
//      getGroveSettings.cache.clear?.()
//
//  它在 catch 里。这是本文件最重要的一个设计，注释（第 77 行）解释得很清楚：
//
//      Don't cache failures — transient network issues would lock the user
//      out of privacy settings for the entire session (deadlock: dialog needs
//      success to render the toggle, toggle calls updateGroveSettings which
//      is the only other place the cache is cleared).
//
//  翻译成场景：网络抖一下 → 结果被缓存成「失败」→ 弹窗渲染不出来 →
//  用户没有 toggle 可点 → 唯一能清缓存的地方（updateGroveSettings）永远不会被调 →
//  **一整个会话都卡死在这个状态**。这是一个真实的死锁。
//
//  判据：**凡是 memoize 一个「可能失败」的操作，都要问一句
//  「失败值被缓存住会不会锁死某个流程」。** 一般答案都是「会」，所以
//  失败路径必须清缓存。'''),

    (108, 'before', '''    // 【markGroveNoticeViewed 也要清缓存，理由写得很具体】
    //
    //  原注释：This mutates grove_notice_viewed_at server-side — Grove.tsx:87
    //  reads it to decide whether to show the dialog. Without invalidation a
    //  same-session remount would read stale viewed_at:null and re-show the
    //  dialog.
    //
    //  这是「写操作必须让读缓存失效」的教科书案例，而且给出了可以复现的现象：
    //  同一个会话里把组件卸载再挂载，弹窗又出现了。
    //
    //  注意注释直接点了调用方文件行号（Grove.tsx:87）。这种跨文件的具体引用
    //  在这份源码里很常见，它把「谁依赖这个字段」钉死了 —— 改的时候能顺着查。
    //
    //  三个写函数（markGroveNoticeViewed / updateGroveSettings / 以及失败路径）
    //  都在做同一件事：**改完立刻让缓存失效**。这说明作者很清楚 memoize
    //  在这里的风险，只是没法用更结构化的方式表达（比如按 key 失效）。'''),

    (157, 'before', '''// 【这个函数名起得很诚实：isQualifiedForGrove，不是 shouldShowGrove】
//
//  差别在于：**合格 ≠ 该显示**。这里只回答「这个账号/组织有没有资格」，
//  真正的「该不该弹」在 calculateShouldShowGrove 里（五个条件）。
//
//  把「有资格」和「该弹」拆成两个函数，好处是：资格可以缓存（24h），
//  而「该弹」要算实时状态（看过没有、宽限期结束没有）。混在一起就没法分别缓存。
//
//  另外注意它的缓存策略和 referral.ts 完全一致：
//
//      无缓存   → 后台取 + 返回 false（这一整个会话不弹）
//      过期     → 返回旧值 + 后台刷新
//      新鲜     → 直接返回
//
//  两个文件、两套业务、同一套骨架。**这种重复说明它是一个团队级的模式，
//  不是一个作者的个人习惯。** 读到一个就想得到另一个。'''),

    (284, 'before', '''// 【这是一个纯函数 —— 五个条件的顺序就是优先级】
//
//      1. 任一 API 失败        → false（拿不准就不弹，宁可少弹）
//      2. 用户已经选过了       → false（grove_enabled !== null）
//      3. showIfAlreadyViewed  → true（强制展示模式，比如测试或首次引导）
//      4. 不在宽限期           → true（必须立刻处理）
//      5. 到提醒周期了 / 从没看过 → true
//
//  第 1 条的方向值得注意：**失败时选择「不显示」而不是「显示」**。
//  反面做法（失败就显示）会让网络差的用户反复看到弹窗，而每次点开都加载失败。
//  「不确定时保持安静」是通知类功能的基本原则。
//
//  第 2 条判断用的是 `!== null` 而不是 `!`，因为 false 是一个**有效的选择**
//  （用户选了「不要帮我改进」）。写成 `if (!settings.grove_enabled)` 的话，
//  选了「否」的用户每次启动都会被再问一遍 —— 这是最典型的一类 bug。'''),

    (310, 'before', '''  // 【提醒周期：把时间戳换成「隔了几天」，然后比整数】
  //
  //      Math.floor((now - viewedAt) / (1000*60*60*24))
  //      return daysSinceViewed >= reminderFrequency
  //
  //  三个细节：
  //
  //    1. 用 Math.floor 向下取整 —— 也就是说 29.9 天算 29 天，
  //       所以「30 天提醒」实际会在第 30 天开始的那一刻触发，不会提前
  //    2. 单位是毫秒，所以要乘三次 —— 这类换算容易写错位数，
  //       写成常量会更安全（但这里选择了直白）
  //    3. else 分支处理「从没看过」：viewedAt 为 null 或 undefined 都算
  //
  //  注意第 310 行的条件 `reminderFrequency !== null && settings.grove_notice_viewed_at`
  //  —— 「配置了周期」和「看过」两个条件都要有，才走「算天数」这条路径。
  //  否则走 else：没看过就显示。这个分支结构保证了**任何一个组合都有答案**，
  //  没有落空的情况。'''),

    (323, 'before', '''// 【非交互模式（claude -p）下的处理：只打印提示，不弹窗】
//
//  非交互模式没有 UI 可以弹，所以只能：
//
//      宽限期内  → 往 stderr 打一句提示，标记为已看过，继续跑
//      宽限期过  → 打一句 [ACTION REQUIRED]，然后 gracefulShutdown(1) 退出
//
//  注意两处都用 writeToStderr 而不是 console.log：**stdout 是给数据用的**
//  （-p 模式的输出可能被管道接走），提示必须走 stderr，否则会污染输出。
//
//  `gracefulShutdown(1)` 而不是 `process.exit(1)`：前者会先 flush 输出、
//  清理临时状态。在「必须退出」的场景里，这个差别决定了用户能不能看到
//  那行提示 —— process.exit 可能把还没写出去的 stderr 一起带走。
//
//  这里还有一个顺序细节：先 writeToStderr 再 await gracefulShutdown。
//  如果反过来，那句提示基本上一定丢失。'''),
]
