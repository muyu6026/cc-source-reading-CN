# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  metricsOptOut：企业有没有关掉用量上报
// ═══════════════════════════════════════════════════════════════
//
//  功能本身很小（一个 GET 问「要不要上报」），但它是**双层缓存 + 后台刷新**
//  的标准范本，而且是本目录里注释质量最高的文件之一 —— 几乎每个「为什么
//  这么写」都被写在了代码旁边。
//
//  读它的顺序建议：先读第 118 行那个函数的注释（总览），再回头看细节。'''),

    (12, 'before', '''// 【返回类型只有两个字段，但两个字段回答的是不同问题】
//
//      enabled   → 业务答案：这个组织允许上报吗
//      hasError  → 工程答案：这个答案可信吗
//
//  为什么要区分？因为「关掉上报」和「查询失败」在消费端必须区别对待：
//
//      查询失败 → 不能写盘（会把一次网络抖动固化成一整天的错误策略）
//      明确关闭 → 可以写盘、可以长期使用
//
//  如果只返回一个 boolean，调用方就只能二选一：要么把失败当关闭（危险，
//  会静默丢掉本该上报的数据），要么把关闭当失败（永远重试，放大请求量）。
//
//  **凡是「远程下发的策略」，返回值里都应该带上「这次答案可不可信」。**'''),

    (22, 'before', '''// 【两层 TTL 的第一个：内存 1 小时】
//
//  作用只是**同一个进程内去重**。比如一个会话里 bigqueryExporter 可能被
//  调很多次，但真正需要问服务端的只有第一次。
//
//  用 memoizeWithTTLAsync 而不是自己写 Map，好处是它同时处理了「并发调用
//  只发一次请求」—— 第一个调用进去建 promise，后面的调用直接拿到同一个
//  promise。这就是所谓的单飞（single-flight）。'''),

    (24, 'before', '''// 【两层 TTL 的第二个：磁盘 24 小时，而且注释给了量化的收益】
//
//  原注释：This is what collapses N `claude -p` invocations into ~1 API call/day.
//
//  这句话是本文件的核心动机。`claude -p` 是一次性调用（脚本、CI 里用），
//  每个进程都活不到几分钟 —— 内存缓存对它完全无效，因为它每次都从零开始。
//  只有**落盘**才能跨进程复用。
//
//  所以两层缓存的职责划分是：
//
//      内存 1h  → 解决「一个长进程里调很多次」
//      磁盘 24h → 解决「很多短进程各调一次」
//
//  这也是为什么磁盘 TTL 更长：组织策略一天变不了几次，而进程数量可能上千。'''),

    (57, 'before', '''  // 【总开关的语义在这里被写清楚了】
  //
  //  原注释：Returning enabled:false sheds load at the consumer
  //  (bigqueryExporter skips export). Matches the non-subscriber early-return
  //  shape below.
  //
  //  「shed load at the consumer」是关键词 —— 这个开关不只是「跳过这一次
  //  网络请求」，而是**让消费端自己停止工作**。所以返回 false 比返回
  //  「错误」更合适：错误会让消费端重试，而我们要的是它别动。
  //
  //  第二句 Matches the non-subscriber early-return shape 是在说：
  //  「故障态」和「免费用户态」返回同样的东西，这样下游只用处理一种情况。
  //  这是一种**状态合并**技巧：把两种不同的原因压成同一个输出。'''),

    (94, 'before', '''// 【refreshMetricsStatus：刷新 + 落盘，两条规则都在注释里】
//
//  规则一：Errors are not persisted — a transient failure should not overwrite
//  a known-good disk value.
//
//  规则二（第 102 行注释）：Skip write when unchanged AND timestamp still fresh
//  — avoids config churn when concurrent callers race past a stale disk entry
//  and all try to write.
//
//  规则二描述的是一个真实并发场景：磁盘缓存过期了，三个并发调用都发现「过期」，
//  于是都去后台刷新，都拿到了同样的结果，都去写盘 —— 三次加锁写盘写的是
//  同一个值。判据 `未变化 且 时间戳还新鲜` 就是为了让后两个直接放弃写入。
//
//  注意这里面有个微妙之处：**「时间戳新鲜」是用写盘时间来衡量的**，
//  而不是用「数据什么时候变的」。因为我们要抑制的是写入放大，不是数据陈旧。'''),

    (134, 'before', '''  // 【这一段注释解释了一个很隐蔽的 bug：缓存投毒】
  //
  //  原文：This check runs before the disk read so we never persist
  //  auth-state-derived answers — only real API responses go to disk.
  //  Otherwise a service-key session would poison the cache for a later
  //  full-OAuth session.
  //
  //  场景还原：
  //
  //      1. 某次用服务账号 token 启动（没有 user:profile scope）
  //      2. 那时如果按「没权限就当作关闭」把 false 写进磁盘
  //      3. 之后用正常 OAuth 登录，读到磁盘里的 false，24 小时内都不再问
  //      4. 结果：明明组织允许上报，却被静默关掉了
  //
  //  所以这条判断必须放在**读磁盘之前**，而且这个分支**不写盘**。
  //  注释用的是 poison（投毒），非常准确：脏数据进了长期缓存，会污染
  //  之后所有本该正常的会话。
  //
  //  通用判据：**凡是「按当前身份算出来的答案」写进跨身份共享的缓存，
  //  就是投毒。** 缓存的键要么包含身份，要么就别缓存。'''),

    (140, 'before', '''    // 【过期时走「先返回旧的、后台刷新」—— stale-while-revalidate】
    //
    //  注意这里只写了 `void refreshMetricsStatus().catch(logError)`，
    //  没有 await。也就是：**用户拿到的是 24 小时前的答案，新的答案在后台取。**
    //
    //  为什么能接受旧答案？注释（第 125 行）说了：caller tolerates stale reads
    //  — a missed export or an extra one during the 24h window is acceptable.
    //  「少上报一次或多上报一次都能接受」—— 有了这句业务上的宽容，
    //  才敢做这个技术选择。**没有业务侧的授权，不要擅自用陈旧数据。**
    //
    //  另外那个 .catch(logError) 不是可有可无的：注释（第 141 行）说明
    //  saveGlobalConfig 的兜底路径可能抛错，而这里是 fire-and-forget，
    //  没有 catch 就会变成 unhandled rejection（在 Node 里可能直接终止进程）。'''),

    (152, 'before', '''  // 【首次运行：阻塞等网络】
  //
  //  这是唯一一个会阻塞的路径，注释也说明了原因：First-ever run on this
  //  machine: block on the network to populate disk.
  //
  //  为什么这里可以阻塞？因为只发生一次，而且必须拿到一个可信的初值 ——
  //  如果首次也返回「先给你个默认值、后台再刷新」，那默认值就必须选一个
  //  「安全」的方向（enabled:false），而那等于第一次运行一定不上报。
  //
  //  设计上的一致性：**阻塞只允许发生在「一次性的冷启动」上，
  //  不允许发生在「每次都要走」的路径上。**'''),
]
