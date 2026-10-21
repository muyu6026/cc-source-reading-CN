# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  api/promptCacheBreakDetection：缓存为什么断了？
// ═══════════════════════════════════════════════════════════════
//
//  提示词缓存能省掉 90% 的输入 token 成本，但它有个残酷的性质：
//  **前缀里改一个字节，后面整段缓存全部失效，而且不会报错。**
//
//  于是这个文件做一件事：每次请求前把「可能影响缓存键的东西」快照下来，
//  和上一次比，一旦发现「缓存命中量掉了」就反查是谁变的，并写一份 diff。
//
//  727 行，是本目录里唯一一个「主动诊断」的模块，其余都是被动记录。'''),

    (103, 'before', '''// 【上限 10 个追踪源 —— 注释算了一笔内存账】
//
//  原文：Each entry stores a ~300KB+ diffableContent string (serialized system
//  prompt + tool schemas). Without a cap, spawning many subagents (each with a
//  unique agentId key) causes the map to grow indefinitely.
//
//  300KB × 无限个子 agent = 内存泄漏。这就是为什么需要 MAX_TRACKED_SOURCES。
//
//  值得学的是这段注释的写法：**它给了量化依据（300KB），而不是只说
//  「防止内存增长」。** 有了数字，读的人才能判断「10 这个值合不合理」：
//  10 × 300KB ≈ 3MB，可以接受；如果是 10 × 30MB，那这个设计就有问题。
//
//  判据：凡是「加了一个上限」的地方，最好同时写清「单项成本 × 上限 = 总成本」，
//  否则后来的人不知道该不该调这个数。'''),

    (109, 'before', '''// 【只追踪五个前缀 —— 这就是「哪些请求值得诊断」的定义】
//
//      repl_main_thread    主对话线程
//      sdk                 SDK 调用
//      agent:custom / agent:default / agent:builtin    三种子 agent
//
//  注释（第 143 行）解释了**为什么不追踪其他来源**：
//
//      Untracked sources (speculation, session_memory, prompt_suggestion, etc.)
//      are short-lived forked agents where cache break detection provides no
//      value — they run 1-3 turns with a fresh agentId each time, so there's
//      nothing meaningful to compare against.
//
//  翻译：那些 fork 出来的短命 agent 每次都是新 agentId，跑 1-3 轮就结束，
//  没有「上一次」可比 —— 诊断它们毫无意义。
//
//  这正是「诊断类功能」的通用取舍：**它只对「长期存在的对象」有价值。**
//  一次性调用的东西不需要监控趋势，只需要看单次日志。
//
//  注释最后一句也很重要：Their cache metrics are still logged via
//  tengu_api_success for analytics —— 也就是「不诊断」不等于「不采集」，
//  数据照记，只是不做对比分析。'''),

    (120, 'before', '''// 【2000 token 的阈值 —— 为什么小抖动不算「断」】
//
//  原文：Small drops (e.g., a few thousand tokens) can happen due to normal
//  variation and aren't worth alerting on.
//
//  正常波动来自哪里？主要是**缓存的分块粒度**：服务端的缓存以一定块大小
//  为单位命中，末尾不满一块的部分不算命中。所以每次请求的 cache_read
//  天然会有几百到几千 token 的浮动。
//
//  阈值定在 2000，就是在「滤掉正常浮动」和「不放过真问题」之间取值。
//  定太低 → 每次请求都报警，没人看；定太高 → 真的断了也发现不了。
//
//  这类阈值没办法算出来，只能**先观察分布再定**。所以注释里写的是
//  「aren't worth alerting on」（不值得报警），而不是「等于噪声上限」——
//  措辞很诚实：这是经验值。'''),

    (122, 'before', '''// 【两个 TTL 常量，其中 1 小时那个是 export 的 —— 为什么】
//
//      CACHE_TTL_5MIN_MS    内部用，判断「这次断是不是 5 分钟过期了」
//      CACHE_TTL_1HOUR_MS   export，别处也要用
//
//  为什么需要这两个阈值？因为「缓存命中量掉了」有一个完全无辜的解释：
//  **上一轮和这一轮隔太久，服务端缓存过期了。**
//
//  所以判断逻辑必然是：
//
//      掉了，但距离上次请求超过 TTL  →  这是过期，不是断
//      掉了，而且距离上次请求很短    →  这是真断，要查
//
//  这就是「先排除正常解释，再报警」的标准思路。没有这一步，所有
//  「用户去泡了杯咖啡」都会被报成缓存断裂。
//
//  另一个 TTL 之所以要 export，是因为别处（成本估算、压缩策略）也要
//  知道「1 小时的缓存什么时候过期」，不能各自硬编码。'''),

    (133, 'before', '''// 【排除 haiku 模型 —— 一行注释，一个被承认的例外】
//
//      function isExcludedModel(model) { return model.includes('haiku') }
//
//  注释：e.g., haiku has different caching behavior
//
//  「行为不同」具体是什么没说，但这一类排除在诊断系统里是必须的：
//  **诊断逻辑建立在「正常情况有稳定模式」的假设上，而有些样本根本不遵循
//  那个模式。** 把它们排除掉，比为了让它们也通过而放宽阈值更好。
//
//  注意判断用的是 includes 而不是精确匹配 —— 因为模型名有一堆变体
//  （带日期、带 provider 前缀）。宽松匹配在这里是对的：**宁可少诊断一个，
//  不要多报一个假警。**'''),

    (160, 'before', '''// 【stripCacheControl：比哈希之前先摘掉 cache_control 字段】
//
//  为什么？因为 cache_control 是**我们贴在内容上的标记**（「从这里开始缓存」），
//  它不是内容本身。
//
//  如果把它算进哈希，会出现一个很微妙的问题：缓存断点位置调整了
//  （比如多贴了一个 cache_control），哈希变了，于是报告「内容变了」——
//  但其实内容一个字节没改。
//
//  所以比较之前要摘掉它。**这是「比较的是语义，不是字节」的典型手法**：
//  先归一化，再比较，否则会得到一堆无意义的差异。
//
//  实现用了 `const { cache_control: _, ...rest } = item` ——
//  「取出并丢弃」的写法，和 dumpPrompts.ts 里摘 messages 是同一个套路。
//  注意它返回新对象，不改原数组（Map 里的快照要保持原样，因为别处还要用）。'''),

    (181, 'before', '''// 【MCP 工具名必须脱敏 —— 注释写清了原因】
//
//  原文：MCP tool names are user-controlled (server config) and may leak
//  filepaths. Collapse them to 'mcp'; built-in names are a fixed vocabulary.
//
//  两个理由，都很硬：
//
//  1. **工具名来自用户配置**（MCP 服务器自己起的名），可能包含路径、项目名、
//     甚至密钥。这个文件会把 diff 写到磁盘、也可能进日志 —— 所以必须脱敏。
//  2. **内置工具名是固定词汇表**，可以安全地保留原样。
//
//  做法是把所有 mcp__ 开头的名字统一压成 'mcp'。代价是「哪个 MCP 工具变了」
//  看不出来 —— 但能看出「MCP 工具这一块变了」，对定位够了。
//
//  这是一条贯穿整个仓库的规则：**任何「用户可控的字符串」都不许原样进
//  日志或上报。** 前面 logging.ts 里那个超长类型名
//  AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS 是同一个约束的
//  另一种表达方式（一个靠类型名提醒，一个靠运行时替换）。'''),

    (224, 'before', '''// 【快照类型：所有字段都是可选的】
//
//  原文注释：All fields are optional so the call site can add incrementally;
//  undefined fields compare as stable.
//
//  两个设计意图：
//
//  1. **调用点可以增量接入**。今天只想比 system 和 tools，就只传这两个；
//     以后再补 betas、mcpServers，不用改类型。
//  2. **undefined 等同于「没变化」**。所以老调用点不传的字段永远不会
//     被误报成「变了」。
//
//  这是一个「渐进式诊断」的接口设计：**新增维度不破坏已有调用方。**
//  代价是它无法表达「这个字段被删了」和「这次没采集这个字段」的区别 ——
//  两者都是 undefined。在诊断场景里这个模糊是可以接受的，因为
//  「没采集」只发生在老调用点，而那些调用点本来就不该报这个维度。'''),

    (668, 'before', '''// 【notifyCacheDeletion / notifyCompaction：两个「提前告知」的入口】
//
//  这两个函数做的事极其简单（改一个布尔量 / 清一个基准值），但它们是
//  整个诊断系统的关键：**告诉它「接下来缓存命中会掉，但这是预期的」。**
//
//  notifyCacheDeletion（第 673 行）
//      microcompact 主动删掉了一些缓存内容 → 下次 cache_read 必然下降
//      → 标记 cacheDeletionsPending，下次比对时跳过报警
//
//  notifyCompaction（第 689 行）
//      压缩之后消息数变少 → cache_read 自然下降
//      → 直接清空 prevCacheReadTokens，让下次重新建立基准
//
//  两个手法不一样，但目的相同：**把「已知的、预期的下降」从报警里排除掉。**
//
//  这揭示了一个诊断系统的通用结构：
//
//      采集（recordPromptState）
//      比对（算差值）
//      排除已知原因（这两个 notify + TTL 判断）
//      才报警
//
//  第三层最容易被忽略，也最容易让诊断变成噪声源。**先做减法，再报警。**'''),

    (684, 'before', '''// 【notifyCompaction 为什么是「清空基准」，而不是「打个标记」】
//
//  对比上一个函数：删除用 bool 标记（cacheDeletionsPending），压缩用
//  置 null（prevCacheReadTokens = null）。
//
//  差别在于「下降的幅度可不可预测」：
//
//      删除几段缓存   幅度大致可估，可以「这一次不比，下一次接着比」
//      压缩           可能砍掉一半上下文，基准完全失效，只能重建
//
//  所以压缩之后必须把基准清掉，让下一轮重新建立「压缩后的正常水位」。
//  否则下一轮会拿「压缩前的大值」去做基准，凭空报一次大跌。
//
//  这是一个很细的判断：**同样是「预期内的下降」，处理方式取决于
//  「基准还能不能用」。**'''),

    (708, 'before', '''// 【最后把差异写成一份 diff 文件 —— 但整个函数包在 try 里】
//
//      const patch = createPatch('prompt-state', prevContent, newContent, 'before', 'after')
//      await writeFile(diffPath, patch)
//      return diffPath
//    catch { return undefined }
//
//  为什么要写成文件，而不是直接打进日志？
//
//  因为 diff 内容可能很长（system prompt 几千字 + 几十个工具 schema），
//  塞进日志会把日志淹掉。写成文件，只在日志里留**路径**，需要的时候再去看。
//
//  这是「大对象日志」的标准做法：**日志里放指针，不放内容。**
//
//  整个函数吞掉所有异常并返回 undefined —— 因为它是诊断功能的最后一环，
//  写文件失败（磁盘满、权限不足）不应该影响任何主流程。
//
//  判据同前：**能降级的诊断用 best-effort，不能降级的主流程才用 throw。**'''),
]
