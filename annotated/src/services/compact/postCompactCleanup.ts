// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 补小件 3/6 —— 压缩后的统一清理
//                              （src/services/compact/postCompactCleanup.ts，77 行）
//
// 【这个文件的形态：一张"清什么、为什么清、什么不清"的清单】
//
// 77 行里有 60 行是注释，8 个函数调用。没有算法，没有分支 ——
// 除了一个 isMainThreadCompact 判断。
//
// 但它的信息密度可能是这一批里最高的，因为每一条都在回答
// "这行代码为什么存在、删了会怎样"。这类文件在真实项目里很有价值，
// 却很少有 —— 因为写的人往往只写代码不写"为什么"。
//
// 【它要解决的问题】
//
// 压缩之后，一堆缓存和状态都**过期**了：它们要么记着"刚才消息数组多长"，
// 要么缓存着基于旧上下文算出的结果。不清的话，下一轮会拿旧状态
// 去配新上下文 —— 而症状通常不是崩溃，是"数字对不上"或"某个功能静默失效"。
//
// 【读这个文件的建议】
//
// 不要试图记住清单本身。记住三件事：
//   ① 有一个判断（主线程 vs 子 agent）决定了哪些该清
//   ② 有两处"故意不清"，理由都比"清"更值得读
//   ③ 有一处"只清内层不够、必须清外层"，是缓存分层的经典陷阱
// ═══════════════════════════════════════════════════════════════
import { feature } from 'bun:bundle'
import type { QuerySource } from '../../constants/querySource.js'
import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'
import { getUserContext } from '../../context.js'
import { clearSpeculativeChecks } from '../../tools/BashTool/bashPermissions.js'
import { clearClassifierApprovals } from '../../utils/classifierApprovals.js'
import { resetGetMemoryFilesCache } from '../../utils/claudemd.js'
import { clearSessionMessagesCache } from '../../utils/sessionStorage.js'
import { clearBetaTracingState } from '../../utils/telemetry/betaSessionTracing.js'
import { resetMicrocompactState } from './microCompact.js'

// 【这段 JSDoc 是全文件的核心，三个"故意不做"比做的部分重要】
//
// ── ① 故意不清 invoked skill 内容 ──
//
//   "Skill content must survive across multiple compactions so that
//    createSkillAttachmentIfNeeded() can include the full skill text in
//    subsequent compaction attachments."
//
//   为什么必须留着？因为下次压缩时，压缩流程需要把**技能的完整原文**
//   放进附件里（否则摘要里那个技能就只剩个名字了）。如果这次压缩
//   把技能内容清了，下次就再也拿不回来了 —— 属于不可逆的信息损失。
//
//   注意这个推理的方向：不是"我需不需要它"，而是"**下游在下一次
//   压缩时需不需要它**"。清理动作要向前看一步。
//
// ── ② querySource 为什么必须传 ──
//
//   "Subagents (agent:*) run in the same process and share module-level
//    state (context-collapse store, getMemoryFiles one-shot hook flag,
//    getUserContext cache); resetting those when a SUBAGENT compacts
//    would corrupt the MAIN thread's state."
//
//   【这是整个文件最重要的一条】
//
//   子 agent **不是独立进程**，它跑在同一个 Node 进程里，
//   和主线程共享所有模块级变量。所以子 agent 压缩时如果清掉
//   "context-collapse 存储"或"memory files 缓存"，主线程的状态
//   就被**别人**清掉了。
//
//   症状会非常诡异：主线程莫名其妙地重新读了一遍 CLAUDE.md、
//   莫名地丢掉上下文折叠状态 —— 而触发点是"某个子 agent 恰好压缩了一次"。
//   因果在时间上离得很远，日志里也看不出关联。
//
//   这就是"共享可变状态"在多 agent 系统里的真实代价：
//   **隔离性必须手动维护，因为语言层面根本没有隔离。**
//
// ── ③ undefined 只在什么情况下安全 ──
//
//   "All compaction callers should pass querySource — undefined is only
//    safe for callers that are genuinely main-thread-only (/compact, /clear)."
//
//   即：`undefined` 被当成"主线程"处理。这个默认值只有在
//   "调用方确实是主线程"时才对。所以新加调用点时**必须传 querySource**，
//   否则一个子 agent 的压缩会被误判成主线程压缩。
/**
 * Run cleanup of caches and tracking state after compaction.
 * Call this after both auto-compact and manual /compact to free memory
 * held by tracking structures that are invalidated by compaction.
 *
 * Note: We intentionally do NOT clear invoked skill content here.
 * Skill content must survive across multiple compactions so that
 * createSkillAttachmentIfNeeded() can include the full skill text
 * in subsequent compaction attachments.
 *
 * querySource: pass the compacting query's source so we can skip
 * resets that would clobber main-thread module-level state. Subagents
 * (agent:*) run in the same process and share module-level state
 * (context-collapse store, getMemoryFiles one-shot hook flag,
 * getUserContext cache); resetting those when a SUBAGENT compacts
 * would corrupt the MAIN thread's state. All compaction callers should
 * pass querySource — undefined is only safe for callers that are
 * genuinely main-thread-only (/compact, /clear).
 */
// 注意函数签名：`querySource?: QuerySource` —— 可选参数。
//
// 可选参数在这个场景里是个**陷阱式设计**（作者用注释补上了）：
// 类型上允许不传，语义上不传就等于"我是主线程"。
// 这是一个"默认值恰好等于最危险的情况"的例子 ——
// 忘了传参数的后果不是报错，是静默地多清了东西。
//
// 【如果重写这个 API，更好的形态】
//
//   runPostCompactCleanup({ scope: 'main' | 'subagent', querySource })
//
//   把 scope 变成**必填**，让编译器帮忙。把"安全默认值"设成
//   更保守的一侧（subagent），而不是更激进的一侧（main）。
//
//   原则：默认值应该指向"破坏性最小"的分支，不是"最常见"的分支。
export function runPostCompactCleanup(querySource?: QuerySource): void {
  // Subagents (agent:*) run in the same process and share module-level
  // state with the main thread. Only reset main-thread module-level state
  // (context-collapse, memory file cache) for main-thread compacts.
  // Same startsWith pattern as isMainThread (index.ts:188).
// 判断规则：undefined（主线程）/ 以 'repl_main_thread' 开头 / 'sdk'。
//
// 注意这里用了 **startsWith** 而不是相等比较 —— 因为 querySource
// 实际长这样：`'repl_main_thread:outputStyle:custom'`。
//
// 【这是个反复出现的坑，microCompact.ts 里刚踩过一次】
//
//   microCompact.ts 的 isMainThreadSource 原来写 `=== 'repl_main_thread'`，
//   结果**所有改过 output style 的用户，缓存微压缩从来没生效过** ——
//   因为他们的 querySource 是 `'repl_main_thread:outputStyle:xxx'`，
//   不等于那个字面量。
//
//   同样的查询源、同样的前缀语义，两个文件各自实现了一遍判断，
//   一个用 startsWith（对），一个用 ===（错）。这就是"同一概念
//   在多处重复实现"的典型代价：修好一处，另一处照旧错着。
//
//   注释里那句 "Same startsWith pattern as isMainThread (index.ts:188)"
//   就是在标记这种重复 —— 作者知道有三处相同的判断。
//
// 【为什么 'sdk' 算主线程】
//
//   因为 SDK 调用方**没有子 agent 的概念**，它就是那个进程里的"主"。
//   把它算成子 agent 会导致它的缓存永远不清，反而更糟。
  const isMainThreadCompact =
    querySource === undefined ||
    querySource.startsWith('repl_main_thread') ||
    querySource === 'sdk'

// 第一个清理：resetMicrocompactState() —— **无条件清**，不管主线程还是子 agent。
//
// 为什么这一个不需要判断？因为它清的是 microcompact 自己的模块状态，
// 而 microcompact 是**跟着这次压缩走的**：谁的压缩结束了，
// 谁的微压缩状态就该重置。不存在"子 agent 清了会伤到主线程"的问题 ——
// 主线程的微压缩状态由主线程自己的压缩流程管。
//
// 【这个对比很有教学价值】
//
//   同样的"清理"动作，有的必须判作用域，有的不必。
//   判断依据不是"清的是什么"，而是"**这份状态是不是被多方共享**"。
//   microcompact 状态是 per-compaction 的，所以不用判；
//   context-collapse / memory cache 是 per-process 的，所以必须判。
  resetMicrocompactState()
// 【这段代码有一个语法细节值得单独看：那个行首分号】
//
// 展开后是这么个形状（注意 require 之前那一行以分号起头）：
//      if (isMainThreadCompact) {
//        /* eslint-disable ... */
//        ;(
//          require('../contextCollapse/index.js') as typeof import(...)
//        ).resetContextCollapse()
//
// 那个**行首分号**不是笔误，是防 ASI（自动分号插入）陷阱。
//
// 如果不加：上一行是 `/* eslint-enable */` 结束后的 `{`，
// JS 引擎在这里插入分号，然后 `(require(...)).resetContextCollapse()`
// 以 `(` 开头 —— 而 `(` 起行的表达式会被解析成"上一句的调用"。
// 在块语句开头以 `(` 或 `[` 起行，是 ASI 的经典雷区。
//
// 【为什么这里要 require 而不是顶层 import】
//
// 因为 CONTEXT_COLLAPSE 是特性开关。顶层 import 会让模块**永远**
// 被加载（打包器删不掉，因为 import 是静态声明）—— 特性关了也白加载。
// 用条件 require 才能让打包器在特性关闭时把整块删掉。
//
// 这和 prompts.ts / claude.ts 里用 `feature('X') ? require(...) : null`
// 是同一个手法，只是这里的开关判断在**函数体内**而不是模块顶部。
//
// 【代价】每次调用都会走一次 require（有模块缓存，开销很小但不是零），
// 而且 if 判断也无法被优化。这是特性开关换取产物体积的标准交易。
  if (feature('CONTEXT_COLLAPSE')) {
    if (isMainThreadCompact) {
      /* eslint-disable @typescript-eslint/no-require-imports */
      ;(
        require('../contextCollapse/index.js') as typeof import('../contextCollapse/index.js')
      ).resetContextCollapse()
      /* eslint-enable @typescript-eslint/no-require-imports */
    }
  }
// 【getUserContext.cache.clear?.() —— 全文件最精妙的一处，值得详细拆】
//
// 上面那段注释说的现象：
//
//   "getUserContext is a memoized outer layer wrapping getClaudeMds() →
//    getMemoryFiles(). If only the inner getMemoryFiles cache is cleared,
//    the next turn hits the getUserContext cache and never reaches
//    getMemoryFiles(), so the armed InstructionsLoaded hook never fires."
//
// ── 链条还原 ──
//
//   调用关系是**两层记忆化**：
//       getUserContext（缓存 ①）
//         └─ getClaudeMds()
//              └─ getMemoryFiles()（缓存 ②）
//
//   只清缓存 ② 会发生什么？
//     下一轮代码调 getUserContext() → 缓存 ① **命中**（它没被清）
//     → 直接返回旧结果 → 根本不会执行到 getMemoryFiles()
//     → 缓存 ② 清了个寂寞
//
//   而「读了 memory 文件」这个动作，会触发 InstructionsLoaded hook。
//   因为永远走不到真正的读取，**hook 永远不触发** ——
//   于是"压缩后重新加载 CLAUDE.md"这件事静默失效。
//
// ── 为什么这个 bug 特别难发现 ──
//
//   ① 两个缓存名字不同、层次不同，看代码时不会自然联想
//   ② 清了"文件名里带 memory 的那个"，看起来已经做到位了
//   ③ 失败模式是"少做一件事"，不是"做错一件事" —— 没有报错、没有异常
//   ④ 症状是"CLAUDE.md 没重新加载"，但用户可能几小时都不改 CLAUDE.md
//
// ── 注释里那句"集中化"的动机 ──
//
//   "Manual /compact already clears this explicitly at its call sites;
//    auto-compact and reactive-compact did not — this centralizes the
//    clear so all compaction paths behave consistently."
//
//   手工 /compact 在它自己的调用点清了；自动压缩和 reactive 压缩**没清**。
//   于是同样的压缩，因为入口不同，行为不一致 ——
//   手工压缩后 CLAUDE.md 会重载，自动压缩后不会。
//
//   这就是这个文件存在的根本理由：**把散落在各入口的清理动作收成一处**。
//   收拢之前，每加一个压缩入口就漏一批清理。
//
// ── `?.` 那个可选链 ──
//
//   `getUserContext.cache.clear?.()` —— clear 后面带 `?.` 是因为
//   记忆化函数的 .cache 形状依赖具体实现（React 的 cache() 和
//   自研 memoize 的接口不同），clear 可能不存在。加 `?.` 让这段
//   在两种实现下都不会崩。代价是：如果将来换了实现、clear 名字变了，
//   这里会**静默跳过**而不是报错。
  if (isMainThreadCompact) {
    // getUserContext is a memoized outer layer wrapping getClaudeMds() →
    // getMemoryFiles(). If only the inner getMemoryFiles cache is cleared,
    // the next turn hits the getUserContext cache and never reaches
    // getMemoryFiles(), so the armed InstructionsLoaded hook never fires.
    // Manual /compact already clears this explicitly at its call sites;
    // auto-compact and reactive-compact did not — this centralizes the
    // clear so all compaction paths behave consistently.
    getUserContext.cache.clear?.()
    resetGetMemoryFilesCache('compact')
// 上面两行是"清 memory 缓存"的收尾：先清外层，再清内层。
//
// 顺序其实不影响结果（两个都清掉了），但读起来是"从外到内"，
// 和刚才那段注释讲的层次关系一致。
  }
  clearSystemPromptSections()
  clearClassifierApprovals()
  clearSpeculativeChecks()
// 【第二处"故意不清"：resetSentSkillNames()】
//
//   "re-injecting the full skill_listing (~4K tokens) post-compact is pure
//    cache_creation."
//
//   重新注入技能清单 = 约 4K token 的**纯缓存创建开销**（cache_creation
//   是按更高单价计费的，不是免费的 input）。
//
//   为什么可以不清？给了三条理由：
//     ① "The model still has SkillTool in schema" —— 模型仍然有调用技能的入口
//     ② "invoked_skills preserves used skills" —— 用过的技能记录还在
//     ③ "dynamic additions are handled by skillChangeDetector / cacheUtils resets"
//        —— 如果有新技能，另有机制会通知
//
//   【这三条的结构值得学：不是"应该没问题"，而是三条各有归属的保证。】
//   一条说"能力还在"，一条说"历史还在"，一条说"变化有别的通路"。
//   三个方向都堵上了，才敢不清。
//
//   这和前面"故意不清 skill 内容"是同一类决定，但理由不同：
//   那个是"下游需要它"，这个是"清了也只是省一点、但代价是 4K token"。
  // Intentionally NOT calling resetSentSkillNames(): re-injecting the full
  // skill_listing (~4K tokens) post-compact is pure cache_creation. The
  // model still has SkillTool in schema, invoked_skills preserves used
  // skills, and dynamic additions are handled by skillChangeDetector /
  // cacheUtils resets. See compactConversation() for full rationale.
// 最后三个清理各有一个特点：
//
//   clearBetaTracingState()
//     → beta 特性追踪状态。压缩改变了上下文，之前记录的 beta 使用轨迹
//       不再对应当前请求，留着会让遥测数据错位。
//
//   feature('COMMIT_ATTRIBUTION') → 动态 import + sweepFileContentCache()
//     → 注意这里是 `void import(...).then(...)`：**不 await**。
//       因为压缩后清理是同步流程，而清文件内容缓存可能要扫很多文件，
//       不值得让主流程等。
//       `void` 前缀是明确告诉读者和 linter："我知道这是个悬空 promise，
//       故意的"。不写 void 的话 TS/ESLint 会警告 floating promise。
//       代价是：如果那个 then 里抛异常，会变成 unhandled rejection。
//       这里可接受，因为它只是清缓存，失败了最坏是下次多扫一遍。
//
//   clearSessionMessagesCache()
//     → 最后一行，清会话消息缓存。这个必须在**所有其他清理之后**，
//       因为前面几个清理函数可能还在读消息缓存。
//
// 【顺序在这里是有意义的，不是随手排的】
//   破坏性的、影响面大的放在后面；只读的、局部的放在前面。
  clearBetaTracingState()
  if (feature('COMMIT_ATTRIBUTION')) {
    void import('../../utils/attributionHooks.js').then(m =>
      m.sweepFileContentCache(),
    )
  }
  clearSessionMessagesCache()
// 文件结束。回头看这 77 行的结构：
//
//   · 1 个判断（主线程 or 子 agent）
//   · 2 处"故意不清"，各带三条理由
//   · 1 处"清内层不够还要清外层"
//   · 8 个清理调用，顺序有讲究
//
// 【如果你想在自己的项目里写一个类似的清理函数，可以照这个模板】
//
//   每条清理都要能回答三个问题：
//     ① 清的是什么缓存/状态？
//     ② 不清会导致什么具体症状？（不是"可能有问题"，要具体）
//     ③ 为什么可以不清？（如果决定不清）
//
//   第三个问题最重要，也最少人写。因为"不清"的决定一旦没有记录，
//   下一个人会以为是漏了，然后加上去 —— 于是重新引入 4K token 的开销。
//   注释在这里的作用不是解释代码，是**阻止未来的错误修改**。
}
