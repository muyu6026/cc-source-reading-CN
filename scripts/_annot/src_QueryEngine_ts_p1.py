# -*- coding: utf-8 -*-
"""QueryEngine.ts 批注 1/3：文件定位、配置类型、类结构、状态字段。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
// 第 5 步 · 主循环 · 3/4 —— 会话容器（src/QueryEngine.ts）
//
// 上一份 query.ts 是「一轮对话怎么跑」：无状态，参数进、消息出。
// 这一份是「一个会话怎么管多轮」：有状态，跨 submitMessage 持久。
//
// 【三层关系，先看清楚再读】
//
//     调用方（REPL / claude -p / SDK）
//          │  只认 SDKMessage 协议
//          ▼
//     QueryEngine          ← 本文件：持会话状态 + 做类型转换
//          │  内部 Message 类型
//          ▼
//     query()              ← 上一份：跑一轮，从头到尾无状态
//
// 所以本文件的核心职责只有两个：
//   ① **状态归属**：mutableMessages、totalUsage、permissionDenials、
//      readFileState —— 这些必须活过一轮，所以不能放 query() 里。
//   ② **边界转换**：内部 Message（含 attachment / tombstone / progress /
//      stream_event 等 9 种类型）→ SDKMessage（对外协议，只有 5 种）。
//
// 【一个容易误读的地方】
// 文件名叫 QueryEngine，但它**不是** query 的引擎 —— 它是 query 的**宿主**。
// query() 才是引擎。这个名字容易让人以为里面是主循环，其实主循环在 query.ts。
//
// 【读这个文件要抓的一条主线】
// 它几乎全部代码都在做同一件事：把一个类型转换 + 更新几个计数器 + 判断
// 要不要提前终止。看下面那张 switch（行 757）就够了 —— 9 个 case，
// 只有 4 个真的 yield 东西给外面。其余都是「内部消化」。
// ═══════════════════════════════════════════════════════════════'''),

(85, 'before', '''// ── 1. 一个"延迟到用时才加载"的模块 ──
// 注释说得很直白：MessageSelector.tsx 会拉进 React/ink（整个终端 UI 渲染栈），
// 而这里只需要它里面的一个过滤函数。
// 如果顶层 import，headless 模式（claude -p）也会被迫加载整套 React。
// ═══════════════════════════════════════════════════════════════'''),
(89, 'after', '''// 注：注意这个写法的形状 —— 它是一个**函数**，不是常量：
//         const messageSelector = () => require('src/components/MessageSelector.js')
//     每次调用 messageSelector() 才 require 一次（Node 的 require 有缓存，
//     第二次是查表，几乎无成本）。
//
//     为什么不用 `import()` 动态导入？因为 import() 返回 Promise，
//     而这里的调用点（行 471、643）都在同步代码里（filter 的回调）。
//     require 是同步的，import() 不是。这就是为什么必须用 require。
//
//     这也是文件里三处 `/* eslint-disable no-require-imports */` 之一，
//     另外两处是条件导入（行 111、121）。三种 require 的用途完全不同：
//       · 行 87  → 延迟加载重模块（避免 headless 拉 React）
//       · 行 115 → 条件导入（DCE）
//       · 行 122 → 条件导入（DCE）'''),

(110, 'before', '''// ── 2. 条件导入的两种写法，对比着看 ──'''),
(117, 'after', '''// 注：这一段和下面行 122 的 snipModule 是**同一个模式**，但写法不同，
//     值得对比：
//
//     【写法 A：带兜底函数】（这里）
//         const getCoordinatorUserContext: (…) => {…} = feature('COORDINATOR_MODE')
//           ? require('./coordinator/coordinatorMode.js').getCoordinatorUserContext
//           : () => ({})
//     特征：类型标注写在变量上（因为两条分支类型不同，要显式收窄），
//           兜底是一个**空实现**而不是 null。
//     好处：调用点不用判空，直接 `getCoordinatorUserContext(mcpClients, ...)`
//           就行（行 304）。外部版里它就是返回空对象的函数，零成本。
//
//     【写法 B：null 兜底】（行 122）
//         const snipModule = feature('HISTORY_SNIP')
//           ? (require(...) as typeof import(...))
//           : null
//     特征：用 `as typeof import(...)` 保留类型，兜底是 null。
//     代价：每个调用点都要判空（`snipModule!.snipCompactIfNeeded`）。
//
//     什么时候用 A、什么时候用 B？看「不启用时该怎么表现」：
//       · 协调器模式不启用 → 就当没这个上下文，返回空对象（A 合适）
//       · snip 不启用 → 整个功能不存在，不该被调用（B 合适，能暴露误用）
//     这个选择标准很实用：**兜底是"空行为"用 A，兜底是"不该发生"用 B。**'''),

(130, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 3. QueryEngineConfig：25 个字段的配置对象 ──
// 这个类型就是「一次会话需要从外部拿到什么」的完整清单。
// 注意它和 query.ts 的 QueryParams 的区别：
//   QueryParams      → 一轮请求要什么（13 个字段）
//   QueryEngineConfig → 整个会话要什么（25 个字段）
//   前者是后者的子集，后者多出来的是「跨轮持久」的东西。
// ═══════════════════════════════════════════════════════════════'''),

(152, 'before', '''// ── 3.1 一个字段的注释比代码还长：snipReplay ──'''),
(173, 'after', '''// 译：Snip 边界处理器：接收每条被 yield 的 system 消息 + 当前可变的
//     messages 存储。如果不是 snip 边界就返回 undefined；否则返回重放后的
//     snip 结果。由 ask() 在 HISTORY_SNIP 启用时注入，这样特性门控的
//     字符串就留在被门控的模块里（让 QueryEngine 不含被排除的字符串，
//     且在 bun test 下 feature() 返回 false 时仍然可测）。
//     仅 SDK 路径：REPL 保留完整历史用于 UI 滚动回溯，按需通过
//     projectSnippedView 投影；QueryEngine 在这里截断，是为了在长
//     headless 会话里限制内存（没有 UI 要保留）。
//
// 注：这个字段的设计理由有四层，一层比一层具体，值得逐层拆：
//
//     ① 【职责倒置】为什么 snip 逻辑不写在本文件里？
//        因为本文件要能通过「被排除字符串」检查（excluded-strings check）——
//        这是个构建期检查：外部版 bundle 里不许出现内部特性相关的字符串。
//        如果本文件直接写 `if (feature('HISTORY_SNIP'))`，
//        字符串 'HISTORY_SNIP' 就进了本文件，检查会失败。
//        解法：把判断逻辑塞进回调，由 ask() 在 feature 为 true 时才注入。
//        这样本文件只有 `this.config.snipReplay?.(...)`，不带任何特性名。
//
//     ② 【为什么不用 import 而是回调注入】
//        回调注入让本文件对 HISTORY_SNIP 完全无感知 ——
//        它只知道「有个可选的回调能处理 system 消息」。
//        这比 import 更彻底：import 至少要写模块路径（也是字符串）。
//
//     ③ 【REPL 和 SDK 的差异】
//        REPL 要保留完整历史（用户能往上滚），所以不能真删。
//        SDK/headless 没有 UI，删了能省内存。
//        所以「截断」这个动作只对 SDK 路径做 —— 这就是为什么
//        snipReplay 只在 ask() 里注入（行 1276-1284），
//        而不在 REPL 的调用路径里注入。
//
//     ④ 【可测性】
//        bun test 下 `feature()` 返回 false，所以如果不注入回调，
//        这段逻辑在测试里完全跑不到。用回调注入后，测试可以传一个
//        假回调来覆盖这条路径 —— 这是「为了让代码可测而改变设计」的例子。
//
//     这四条合起来，是「一个字段为什么要存在」的完整答案。
//     本文件里没有第二个字段有这么长的注释，因为它是唯一一个
//     「设计动机跨了构建期、运行时、两条产品路径、测试」的字段。'''),

(175, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 4. 类的定位（这段注释是官方说明，先读它） ──
// ═══════════════════════════════════════════════════════════════'''),
(184, 'before', '''// 译：QueryEngine 拥有一次对话的 query 生命周期与会话状态。
//     它把核心逻辑从 ask() 里抽出来，成为一个独立类，
//     以便 headless/SDK 路径和（未来阶段的）REPL 都能用。
//
//     一个对话一个 QueryEngine。每次 submitMessage() 调用在同一对话内
//     开启新的一个 turn。状态（messages、文件缓存、用量等）跨 turn 持久。
//
// 注：注意三句话里的三个关键信息：
//
//     ① "extracts the core logic from ask()" —— 这是**重构产物**。
//        原来 ask() 是一个巨型函数（可能就是上一个文件 query.ts 的前身），
//        后来把「会话状态 + 类型转换」抽成类，ask() 变成薄包装（行 1186）。
//        这个演化路径很典型：函数太长 → 抽出状态 → 变成类 → 原函数变门面。
//
//     ② "and (in a future phase) the REPL" —— REPL 还没用上。
//        这是个**未完成的迁移**：现在只有 headless/SDK 走 QueryEngine，
//        REPL 还是自己管状态。所以本文件里很多地方写着「SDK 路径怎么做」，
//        潜台词是「REPL 路径在别处做，而且做法不同」。
//        行 164-167 的 snipReplay 注释就是这个差异的直接证据。
//
//     ③ "One QueryEngine per conversation" —— 一个会话一个实例。
//        这意味着：/clear（清空对话）= 新建实例；
//        --resume（恢复会话）= 用 initialMessages 装满再复用。
//        而「一次 submitMessage」才是 query() 的一次调用。
//        所以实例生命周期 : query() 调用 = 1 : N。'''),

(184, 'after', '''// 注：注意类是 `export class`，而 `ask()` 是 `export async function*`。
//     两个出口，两种使用方式：
//       多轮场景 → new QueryEngine(config)，然后反复 submitMessage
//       一次性   → ask({...})，内部 new 一个用完就丢（行 1249）
//     ask() 存在纯粹是为了「不用管状态」的调用方（脚本、单次查询）。
//
//     还有个细节：类没有实现任何接口，也没被继承。它是一个**封闭的**类 ——
//     这说明它的「可替换性」不是设计目标，只是被抽出来复用。
//     如果哪天要支持第二种引擎（比如换一个 provider），
//     大概会先抽一个 interface 再让这个类实现。'''),

(186, 'before', '''// ── 5. 六个私有字段：会话状态的完整清单 ──'''),
(198, 'after', '''// 注：七个字段（含行 197 的两个 Set），分成三类：
//
//   【跨 submitMessage 持久】
//     config              → 配置（行 1175 的 setModel 会改它）
//     mutableMessages     → **完整对话历史**（最重要的一个）
//     abortController     → 取消句柄（跨轮复用！所以一次中断会杀掉整个会话）
//     readFileState       → 文件读取缓存（跨轮累积，避免重复读盘）
//     totalUsage          → 累计 token 用量（result 消息里报这个）
//
//   【每次 submitMessage 重置】
//     permissionDenials   → 构造函数里初始化（行 204），但注意：
//                           **它从不清空**！见下面那条批注。
//     hasHandledOrphanedPermission → 一次性标志，整个生命周期只处理一次
//
//   【每轮清理，但跨两次 context 重建持久】
//     discoveredSkillNames → 行 193-196 的注释解释了为什么需要它：
//                            submitMessage 内部要重建两次
//                            processUserInputContext（行 335、492），
//                            这个 Set 必须在两次之间存活，
//                            但每个 submitMessage 开头要 clear()（行 238）
//                            以免 SDK 模式多轮后无限增长。
//
//   ⚠ 一个值得注意的现象：`permissionDenials` 在构造函数里设为 []
//     （每实例一次），但 submitMessage 里没有清空。
//     所以第二次 submitMessage 的 result.permission_denials
//     会包含第一次的拒绝记录。这可能是 bug，也可能是刻意的
//     （SDK 调用方想知道「这个会话一共被拒过什么」）。
//     从字段名（复数、无 turn 前缀）看，倾向于是刻意的累积语义 ——
//     但和 `totalUsage`（也累积）不同，它没有注释说明。'''),

(200, 'before', '''// ── 6. 构造函数：四行，但有两处默认值值得注意 ──'''),
(207, 'after', '''// 注：四个默认值：
//       config.initialMessages ?? []        → 空会话（--resume 时由调用方填）
//       config.abortController ?? createAbortController()
//                                           → 外部可以注入，这样调用方能
//                                             在 submitMessage 之外取消
//                                              （比如 SIGINT 处理器）
//       readFileState = config.readFileCache → **注意是直接赋值，不是克隆**
//       totalUsage = EMPTY_USAGE            → 共享的冻结常量
//
//     第二、三行有个对比：abortController 用了 `??` 兜底，
//     而 readFileCache 是必填字段（类型里没有 `?`）。为什么？
//     因为 abort 可以在任何时候发生（包括还没开始跑），
//     而文件缓存一定是调用方已经建好的（它要跨 session 复用）。
//
//     第三行「直接赋值不克隆」值得留意：ask() 里传进来的是
//     `cloneFileStateCache(getReadFileCache())`（行 1259），
//     所以**克隆发生在 ask() 里，不在构造函数里**。
//     这意味着直接 new QueryEngine 的调用方必须自己负责克隆 ——
//     否则两个引擎会共享同一个缓存对象。
//     构造函数不克隆是个有意的选择（避免双重克隆），但把责任
//     推给了调用方，是个隐式契约。'''),

(209, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 7. submitMessage：整个类的全部逻辑（约 950 行）──
//
// 返回类型 `AsyncGenerator<SDKMessage, void, unknown>` 和 query() 不同：
//     query()        → AsyncGenerator<内部消息, Terminal, unknown>
//     submitMessage  → AsyncGenerator<SDKMessage, void, unknown>
// 两个区别：产出的是 SDKMessage（对外协议），返回的是 void（不暴露终止原因）。
// **内部的控制流细节（Terminal）在这里被吞掉了** —— 对外只说
// 「成功了还是失败了」，不说「因为 max_output_tokens 恢复失败而终止」。
// ═══════════════════════════════════════════════════════════════''')
]
