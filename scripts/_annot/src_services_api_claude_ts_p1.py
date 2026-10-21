# -*- coding: utf-8 -*-
"""claude.ts 批注 1/4：文件总览、feature 条件导入、缓存控制、effort/task_budget、API 元数据、key 校验。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
// 第 5 步 · 主循环 · 4/4 —— API 客户端（src/services/api/claude.ts）
//
// 前面三个文件在「组装请求」和「消费响应」：
//   prompts.ts     → 决定发给模型什么文字
//   query.ts       → 决定一轮一轮怎么跑
//   QueryEngine.ts → 决定对外的消息长什么样
// 这个文件负责**中间那一段字节流**：把参数变成 HTTP 请求，把 SSE 事件变成
// AssistantMessage，中间夹着重试、超时、缓存、降级。
//
// 【它有多长，为什么这么长】
// 3,419 行，27 个顶层符号。但体重几乎全压在一个函数上：
//
//     queryModel          行 1017 → 2892     1,881 行
//
// 这是整个代码库最长的单个函数。拆开看是五段首尾相接的流程：
//
//     ① 组装（1017-1537）      查开关、拉 betas、滤工具、归一化消息、拼 system
//     ② 参数工厂（1538-1729）  paramsFromContext(重试上下文) → 一次请求的全部参数
//     ③ 发请求（1776-1857）    withRetry 包住，拿到 raw stream
//     ④ 解析流（1932-2403）    for await (part of stream) + 一个大 switch
//     ⑤ 降级与收尾（2404-2892）流挂了 → 非流式重试 → 记日志 → 释放资源
//
// 不要顺序读。先读 ② 和 ④，这两段是「协议本体」；
// ① 是配置拼装（长但没有分支难度），③⑤ 是容错（长且分支密集）。
//
// 【四个贯穿全文件的概念，先记住再往下看】
//
//   ① prompt cache 是第一约束
//      这个文件里几乎每个「看起来奇怪的写法」都在服务同一件事：
//      让两次请求的前缀字节完全一致。sticky-on latch（行 1405）、
//      delta attachment（行 1330）、advisor 工具排在最后（行 1386）、
//      temperature 只在 thinking 关闭时发送（行 1691）——全是这个原因。
//
//   ② 参数必须每次重试重新构造
//      不是「构造一次、重试复用」。paramsFromContext(retryContext) 是工厂函数，
//      withRetry 每个 attempt 调一次，因为重试可能换了模型、改了 max_tokens。
//
//   ③ 流式事件是**碎片**，不是完整消息
//      一个 tool_use 块要经过 content_block_start（给个空壳）→
//      几十个 input_json_delta（片段拼 JSON 字符串）→ content_block_stop（收口）
//      才变成一条完整消息。所以这里有大量「半成品状态」变量。
//
//   ④ 降级路径比正常路径长
//      流式失败 → 非流式重试（行 2534）；流没事件 → 也走非流式（行 2350）；
//      404 → 也走非流式（行 2612）。正常路径约 100 行，其余全是
//      「怎么在坏掉的时候还能出结果」。
// ═══════════════════════════════════════════════════════════════'''),

(104, 'before', '''// 条件导入：feature() 为假时，整个模块不会被打包进来。
//
// 读这段有个顺序陷阱要注意：feature 是从 'bun:bundle' 导入的，但这里在第 105 行
// 就用了，而 import 语句在**第 109 行**才写。能跑是因为 ESM 的 import 声明会被
// 提升（hoist），模块绑定先于语句执行。写代码别学这个顺序，读代码别被它绕进去。
//
// 为什么用 require 而不是 import：import 是静态声明，打包器一定会把模块拉进来；
// require + 三元是唯一能让 bun 的 DCE（死代码消除）整块删掉的写法。
// 这也是全代码库『feature() 只能出现在 if / 三元条件里』这条硬约束的由来——
// 一旦你把 feature() 的结果存进变量，压缩器就不敢删了。'''),

(260, 'before', '''// 一个极简的 JSON 值类型。用递归类型别名而不是 unknown，
// 是因为 getExtraBodyParams 的返回值要被展开进请求体（...extraBodyParams），
// 用 unknown 会让整个展开处报类型错误。'''),

(272, 'before', '''// ── getExtraBodyParams ──
// 把「用户环境变量 + beta 头」翻译成要展开进请求体的键值对。
// 名字叫 extra，实际承担三件事：
//   1. 让用户可以任意注入请求体字段（调试/接入第三方网关的主要口子）
//   2. 内测功能（anti_distillation）
//   3. Bedrock 的 beta 头必须放在 body 里而不是 HTTP 头（见行 1549）'''),

(286, 'after', '''// 这一行看着多余，其实是修 bug 的。
// safeParseJSON 是带 LRU 缓存的：同一个字符串第二次解析直接返回**同一个对象引用**。
// 如果这里写 result = parsed，下面 result.anthropic_beta = ... 就是在改缓存里的对象，
// 同一次会话里后续所有请求都会读到被污染的旧值。
// { ...parsed } 是浅克隆——够用，因为下面只改顶层键（anti_distillation / anthropic_beta）。'''),

(301, 'before', '''// 反蒸馏：给第一方 CLI 发一个「请注入假工具」的信号，
// 让抓取流量的第三方拿到的工具列表是不可用的。
// 条件里三层 and 的顺序是刻意的：先判最便宜的 feature() 常量，
// 再判环境变量，最后才查 GrowthBook（有磁盘缓存但仍是函数调用）。'''),

(333, 'before', '''// ── 缓存开关 ──
// 缓存默认开，只能通过环境变量按模型关掉。
// 为什么是「按模型关」而不是全局关：缓存有写入成本（首次请求多花钱），
// 小模型的一次性调用（如 Haiku 分类）几乎不会命中，开了反而更贵。'''),

(358, 'before', '''// cache_control 是打在请求体里的「缓存打点」：标在哪一块，
// 服务端就把从开头到这一块的整段前缀缓存起来。
// 它同时决定三件事：缓存到哪、缓存多久（ttl）、缓存放在哪个命名空间（scope）。
//
// 返回值刻意用条件展开而不是给 undefined：{ ttl: undefined } 和 {} 在
// JSON 序列化后虽然一样，但 SDK 会做键存在性判断，多余字段可能触发不同分支。'''),

(393, 'before', '''// ── 1 小时 TTL 的判定 ──
// 默认 TTL 是 5 分钟，1h 需要单独申请（更贵，但适合长时间思考/长任务）。
// 这个函数最值得注意的是它**把两个判断结果都存进了 bootstrap state**。
// 为什么不每次现算：会话跑到一半，用量跨过分界线会让 isUsingOverage 翻转，
// 于是 cache_control.ttl 从 1h 变回 5m —— 服务端缓存键里带着 TTL，
// 一变整条前缀作废，约 20K token 按全价重算。'''),

(403, 'before', '''// latch（锁存）：第一次算出来就写进 state，之后永远读缓存值。
// getPromptCache1hEligible() 返回 null 表示「本会话还没算过」，
// 这是三态设计——null（未定）/ true / false，用 null 区分「没算」和「算出来是 false」。'''),

(436, 'before', '''// ── effort 参数 ──
// effort 是「模型该花多大力气」的旋钮。三种取值形态：
//   undefined      → 只加 beta 头，不发值（让服务端用默认档）
//   字符串          → 直接放进 output_config.effort
//   数字（仅内测）   → 走 anthropic_internal.effort_override 这个私有通道
// 注意 `'effort' in outputConfig` 这个提前返回：如果用户已经在
// CLAUDE_CODE_EXTRA_BODY 里手填了 effort，就不要覆盖他。'''),

(468, 'before', '''// task_budget 是「服务端记账」的预算：告诉模型总共多少 token、还剩多少，
// 让模型自己规划节奏（比如提前收尾、少调工具）。
//
// 别和 tokenBudget.ts 搞混——那是**客户端记账**：客户端数着 tokens，
// 到 500k 就自动续跑一轮。两者同时存在，各有各的用途：
//   客户端预算 = 控制「什么时候再来一轮」
//   服务端预算 = 告诉模型「你还有多少余量，省着点」
// 因此在 query.ts 里压缩上下文之后，必须把 remaining 补偿回来，
// 否则模型会以为自己快没预算了。'''),

(479, 'before', '''// 写入 output_config.task_budget，并按需加 beta 头。
//
// shouldIncludeFirstPartyOnlyBetas() 这个门禁很关键：task_budget 是 EAP 阶段
// 的第一方独占能力，发给 Bedrock/Vertex 会直接 400。'''),

(503, 'before', '''// ── 请求元数据 ──
// metadata.user_id 是一个**塞了 JSON 的字符串**（不是对象），这是 API 的约定。
// 里面藏了 device_id / account_uuid / session_id——服务端靠这些做用量归因。
// account_uuid 只在真的用 OAuth 时才有值，用 API key 时是空串。'''),

(530, 'before', '''// ── 启动时校验 API key ──
// 交互模式下用最小请求（max_tokens: 1，内容就是 "test"）探一次。
// 非交互模式（-p / print 模式）直接返回 true 跳过——因为那种场景下
// 任何一次失败都意味着整个流程失败，没必要多花一次往返。
//
// 这里刻意用 withRetry 而不是裸调用：校验失败要能区分
// 「key 真的错了」（返回 false）和「网络/限流问题」（抛出，由上层重试）。'''),

(540, 'after', '''// 这条 WARNING 值得单独说：换模型会让这个探测请求在第一方直接失败。
// 原因是第一方的系统提示词前缀是白名单校验的（getCLISyspromptPrefix），
// 只有 Haiku 这类小模型的调用被允许带上 CLI 的特定前缀。
// 换句话说：这不是性能考虑，是兼容性约束。'''),

(554, 'after', '''// biome-ignore 说明这是**故意**绕过 lint 规则：全代码库只有 API key 校验
// 这一处允许直接调 beta.messages.create，不走 queryModel 那条主链路。
// 因为主链路会注入一大堆东西（缓存、beta 头、tool schema、system prompt 前缀），
// 而这些在「只想知道 key 有没有效」这个场景里全是负担，还可能掩盖真实错误。'''),
]
