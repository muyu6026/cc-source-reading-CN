# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  overageCreditGrant：超额用的那笔赠送额度，能不能领、领没领
// ═══════════════════════════════════════════════════════════════
//
//  这是「按组织缓存」的典型样本。和上一个文件（metricsOptOut）的区别很关键：
//
//      metricsOptOut      →  一个全局答案，所有组织一样
//      overageCreditGrant →  每个组织一个答案，缓存的键必须带 orgId
//
//  这个区别决定了缓存结构：一个扁平对象 vs 一个以 orgId 为键的字典。'''),

    (9, 'before', '''// 【五个字段，回答的是三个不同的问题】
//
//      available  这个功能对你开放吗（灰度 / 地区 / 版本）
//      eligible   你有资格领吗（套餐、席位）
//      granted    你到底领了没有
//      amount / currency  领了多少
//
//  这三个不是同一个维度上的状态机，而是**三次独立的判断**，任何一个为假
//  都会让 UI 不显示。把它们合成一个枚举是错的 —— 因为「有资格但还没领」
//  和「没资格所以当然没领」在运营上是完全不同的两件事。
//
//  注释（第 26 行）还说明了为什么客户端不自己算资格：
//  The backend resolves tier-specific amounts and role-based claim permission.
//  **规则留在服务端，客户端只读结论** —— 这样规则改了下发就生效。'''),

    (48, 'before', '''// 【缓存读取：过期就当没有，而不是「返回旧的 + 后台刷新」】
//
//  这和 metricsOptOut / referral 的做法**不一样**，值得对照：
//
//      referral           →  过期时返回旧值 + 后台刷新（用户能看到数字）
//      metricsOptOut      →  过期时返回旧值 + 后台刷新（上报不敏感）
//      overageCreditGrant →  过期时直接返回 null（当作没有）
//
//  为什么这里更严格？因为这是**钱**。显示一个过期的「你能领 50 美元」，
//  用户点了发现不能领，比什么都不显示糟糕得多。
//
//  同一个仓库里三个相似的缓存函数，三种过期策略 —— 差异来自业务后果的严重性，
//  不是编码风格。读的时候要能说出「为什么这个可以旧、那个不可以」。'''),

    (61, 'before', '''// 【失效只删当前组织的条目 —— 注释特别强调了这一点】
//
//  原注释：Drop the current org's cached entry so the next read refetches.
//  Leaves other orgs' entries intact.
//
//  为什么要强调？因为最省事的写法是 `overageCreditGrantCache: {}` ——
//  一行清空全部。但用户可能在多个组织间切换（同一个 CLI 登录不同 org），
//  清空全部会让其他组织的缓存也白丢，下次切换回去又要重新等网络。
//
//  所以这里做了一次浅拷贝 + delete 单个键：
//
//      const next = { ...prev.overageCreditGrantCache }
//      delete next[orgId]
//
//  注意 `delete` 是必须的，不能写成 `next[orgId] = undefined` ——
//  后者会让键还在，`orgId in cache` 仍然为真，第 65 行那个提前返回就会误判。'''),

    (87, 'before', '''  // 【saveGlobalConfig 的回调里从 prev 读，而不是外面读 —— 注释给了理由】
  //
  //  原文：Derive from prev (lock-fresh) rather than a pre-lock
  //  getGlobalConfig() read — saveConfigWithLock re-reads config from disk
  //  under the file lock, so another CLI instance may have written between
  //  any outer read and lock acquire.
  //
  //  翻译：`prev` 是**拿到文件锁之后重新读的**最新内容。如果你在调用
  //  saveGlobalConfig 之前先 getGlobalConfig() 读一次，这中间可能隔了
  //  几毫秒 —— 另一个 CLI 进程在这几毫秒里可能刚写过盘。你手上的那份就旧了。
  //
  //  所以正确姿势是：**所有「读—比较—写」都在回调内部完成**，
  //  回调外面不要持有任何配置快照。这条规则在本文件里贯彻得很彻底
  //  （第 92 行的 prevCached 就是唯一的数据来源）。'''),

    (94, 'before', '''    // 【逐字段比较，而不是深比较（isEqual）】
    //
    //  五个字段手写比较，看起来笨。但对比 bootstrap.ts 用的 isEqual：
    //
    //      bootstrap        clientData 是任意结构  →  只能深比较
    //      overageGrant     五个已知的原始类型      →  手写更快也更明确
    //
    //  更重要的是：手写比较**会在加字段时提醒你**。将来服务端多给一个字段，
    //  深比较会自动把它纳入比较（行为正确但你可能没意识到），
    //  手写比较则会让「新字段变了但没写进比较」变成一次显式的代码审查。
    //
    //  取舍：字段少且固定 → 手写；结构未知 → 深比较。'''),

    (101, 'before', '''    // 【两个条件同时成立才跳过写入 —— 缺一不可】
    //
    //      dataUnchanged           数据没变
    //      Date.now() - timestamp <= TTL   时间戳还新鲜
    //
    //  为什么「数据没变」还不够？因为时间戳也要更新。
    //  如果数据没变就不写，时间戳会一直停在旧值上，于是 getCachedOverageCreditGrant
    //  每次都会判「过期」，每次都会触发一次刷新 —— 变成**每条请求打一次 API**。
    //
    //  这就是本文件最容易漏的一处设计：**TTL 缓存里的「跳过写入」必须区分
    //  「跳过数据写入」和「跳过时间戳更新」。** 这里用「两个条件」表达了
    //  「既没变也还新鲜，才连时间戳都不用碰」；否则走下面那条路径，
    //  数据沿用旧的（existing）但时间戳刷新成现在。'''),

    (127, 'before', '''// 【格式化只认 USD，其他币种返回 null】
//
//  注释写得很直白：For now only USD; backend may expand later.
//  以及 Returns null if... currency we don't know how to format.
//
//  为什么不在不认识的时候返回 `${amount} ${currency}`？
//  因为 amount_minor_units 是**最小货币单位**（美分）。日元没有小数位，
//  韩元也是。直接除以 100 会显示成「¥100.00」这种错得很难看的结果。
//
//  所以这里的 null 是**诚实的不知道**：不知道这个币种有几位小数，
//  就不显示。这比显示一个错误的金额好。
//
//  顺带注意 Number.isInteger 那个分支：$50 不写成 $50.00 —— 文案洁癖，
//  在人看的界面上有意义。'''),
]
