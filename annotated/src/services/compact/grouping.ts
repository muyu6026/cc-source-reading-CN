// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 补小件 2/6 —— 按 API 轮次分组
//                                    （src/services/compact/grouping.ts，63 行）
//
// 【一句话：给消息数组切刀口，只在"真正开始新一轮 API 响应"的地方切】
//
// 为什么压缩需要这个？因为压缩要"砍掉一部分历史"，砍就必须选刀口。
// 刀口选错会导致发 API 时 400 —— 比如把 tool_use 和它的 tool_result
// 切开，或者把同一次响应拆出的多个消息块切开。
//
// 这个 63 行的函数是 compact.ts 里 PTL 逃生舱（truncateHeadForPTLRetry）
// 的底层依赖 —— 那里"按组砍头"，砍的单位就是这里分出来的组。
//
// 【函数本身只有 20 行有效逻辑，剩下 40 行全是注释。比值说明问题】
//
// 这段注释解释了三个"为什么不是更简单/更复杂的写法"，每一条都是
// 踩过坑之后的结论。60 行代码配 40 行注释，不是话多，
// 是因为这三个决定**看起来都像可以简化，实际都不能**。
// ═══════════════════════════════════════════════════════════════
import type { Message } from '../../types/message.js'

// 这段 JSDoc 里有三条硬信息，逐条拆：
//
// 【① 为什么"assistant 的 message.id 变化"是一个 API 安全的刀口】
//
//   "the API contract requires every tool_use to be resolved before the
//    next assistant turn, so pairing validity falls out of the
//    assistant-id boundary"
//
//   API 协议规定：下一次 assistant 响应开始之前，上一轮所有 tool_use
//   **必须**都拿到 tool_result。所以只要按"新的 assistant id"切，
//   配对天然是完整的 —— 不需要额外检查。
//
//   这是一条"从协议不变量推导出实现正确性"的推理，比事后加校验更可靠。
//
// 【② 为什么从"人类轮次分组"改成"API 轮次分组"】
//
//   "allowing reactive compact to operate on single-prompt agentic
//    sessions (SDK/CCR/eval callers) where the entire workload is one
//    human turn"
//
//   老写法只在**真人发话**处切。但有一类使用者（SDK 调用、CCR、eval）
//   整个任务就只有一条人类消息，之后全是模型自己在那调工具。
//   按人类轮次分组的话，这种会话**整段只有一组** —— 压缩想砍也砍不动。
//
//   这是"分组粒度太粗导致功能在特定场景下完全失效"的典型案例，
//   而且不会报错，只是压缩静默不生效。
//
// 【③ 为什么单独拆成一个文件】
//
//   "Extracted to its own file to break the compact.ts ↔ compactMessages.ts
//    cycle (CC-1180) — the cycle shifted module-init order enough to
//    surface a latent ws CJS/ESM resolution race in CI shard-2."
//
//   拆文件不是为了整洁，是为了**打破循环依赖**。
//
//   而循环依赖的危害被这句话说透了：它改变了**模块初始化顺序**，
//   于是暴露了一个潜伏的 ws 库 CJS/ESM 解析竞态。
//   注意"latent"（潜伏）和"CI shard-2"（只在某个分片）——
//   这类 bug 的定位成本极高，因为症状（ws 解析失败）和原因
//   （两个业务模块互相 import）之间没有任何语义关联。
//
//   【可迁移结论】循环依赖真正的代价不是"代码不好看"，
//   而是**初始化顺序变成隐式的、由 import 图决定的状态**，
//   然后某些依赖初始化顺序的第三方库就会在特定条件下崩。
/**
 * Groups messages at API-round boundaries: one group per API round-trip.
 * A boundary fires when a NEW assistant response begins (different
 * message.id from the prior assistant). For well-formed conversations
 * this is an API-safe split point — the API contract requires every
 * tool_use to be resolved before the next assistant turn, so pairing
 * validity falls out of the assistant-id boundary. For malformed inputs
 * (dangling tool_use after resume/truncation) the fork's
 * ensureToolResultPairing repairs the split at API time.
 *
 * Replaces the prior human-turn grouping (boundaries only at real user
 * prompts) with finer-grained API-round grouping, allowing reactive
 * compact to operate on single-prompt agentic sessions (SDK/CCR/eval
 * callers) where the entire workload is one human turn.
 *
 * Extracted to its own file to break the compact.ts ↔ compactMessages.ts
 * cycle (CC-1180) — the cycle shifted module-init order enough to surface
 * a latent ws CJS/ESM resolution race in CI shard-2.
 */
// 看这个函数的结构：一个循环 + 一个"上次见到的 assistant id"变量。
// 20 行里没有一行是多余的，但真正做判断的只有那个 if。
export function groupMessagesByApiRound(messages: Message[]): Message[][] {
  const groups: Message[][] = []
  let current: Message[] = []
// 【全文件最关键的一句注释：为什么判据只有一个 id】
//
// 先说这个 id 判据要解决的**具体问题**：
//
//   normalizeMessages 会把一次 API 响应的每个 content block 拆成
//   一条独立的 AssistantMessage。所以一次响应可能产出三条消息：
//       [assistant(id=X, text), assistant(id=X, tool_use_A), assistant(id=X, tool_use_B)]
//
//   而 StreamingToolExecutor 会在流式过程中**实时**把 tool_result
//   插进来（注释说的 "yield order, not concat order"，见 query.ts:613）。
//   于是实际数组可能长这样：
//       [tu_A(id=X), result_A, tu_B(id=X)]
//
//   如果按"看到 assistant 就切"，这三条会被切成三组 —— 而
//   tu_A / result_A / tu_B 必须在一起（它们属于同一次响应）。
//   靠 message.id 判断就正确了：三条都是 X，不切。
//
// 【所以紧接下面那段英文注释，讲的就是这个结论】
//
//   同一次响应的所有块共享 id → 只有真正的新一轮才会触发刀口。
//   这是用**协议自带的字段**当分组键，而不是自己维护状态。
//
//   注意注释里那个"sole"（唯一的）：作者强调判据**只有这一条**，
//   不是"主要靠这个"。这句话是在防止后来的人"顺手多加一条判断" ——
//   因为每多一条判据，就多一个把刀口焊死的可能（见下一条批注）。
  // message.id of the most recently seen assistant. This is the sole
  // boundary gate: streaming chunks from the same API response share an
  // id, so boundaries only fire at the start of a genuinely new round.
  // normalizeMessages yields one AssistantMessage per content block, and
  // StreamingToolExecutor interleaves tool_results between chunks live
  // (yield order, not concat order — see query.ts:613). The id check
  // correctly keeps `[tu_A(id=X), result_A, tu_B(id=X)]` in one group.
  let lastAssistantId: string | undefined

// 【第二关键的注释：为什么**不**去追"未解决的 tool_use"】
//
// 直觉上有一种"更严谨"的做法：维护一个未解决 tool_use 的集合，
// 集合空的时候才允许切。听起来更对，实际上更糟。
//
// 注释里的理由：
//   "in that case it pins the gate shut forever, merging all subsequent
//    rounds into one group"
//
//   畸形输入（resume 之后悬挂的 tool_use、max_tokens 截断留下的半个调用）
//   会让集合**永远非空** → 刀口永远不开 → 后面所有轮次并成一大组
//   → 压缩想砍头的时候，发现"只有一组"，等于什么也砍不掉。
//
//   注意这是**故障放大**：一个局部的畸形（一条悬挂 tool_use）
//   会让整个压缩机制在该会话里彻底失效，而且症状是"压缩没反应"，
//   完全指不到真正的原因。
//
// 【作者的选择：放任边界照常触发，把修复推给 API 层】
//
//   "We let those boundaries fire; the summarizer fork's own
//    ensureToolResultPairing at claude.ts:1136 repairs the dangling tu
//    at API time."
//
//   也就是说：分组阶段**不做防御**，相信下游。下游（claude.ts 发送前的
//   ensureToolResultPairing）会把悬挂的 tool_use 补成配对。
//
// 【这是一个值得学的分工原则】
//
//   同一个问题（tool 配对）在两个层面都能修：
//     · 在分组阶段修 → 需要维护状态、会让故障放大到整个机制
//     · 在发送阶段修 → 已经是必经之路、修复动作局部且必被执行
//
//   选后者。判断依据是：**谁能用最少的状态、最小的爆炸半径修掉它。**
//   而不是"谁先遇到谁修"。
  // In a well-formed conversation the API contract guarantees every
  // tool_use is resolved before the next assistant turn, so lastAssistantId
  // alone is a sufficient boundary gate. Tracking unresolved tool_use IDs
  // would only do work when the conversation is malformed (dangling tool_use
  // after resume-from-partial-batch or max_tokens truncation) — and in that
  // case it pins the gate shut forever, merging all subsequent rounds into
  // one group. We let those boundaries fire; the summarizer fork's own
  // ensureToolResultPairing at claude.ts:1136 repairs the dangling tu at
  // API time.
// 循环本体只有 15 行。注意两个细节：
//
//   ① 切分的条件里带了 `current.length > 0`
//      没有这一条的话，如果**第一条**消息就是 assistant（比如 resume 后
//      直接从 assistant 开始），会 push 一个空组进去 —— 空组在后续
//      "按组砍头"里会造成 off-by-one。
//
//   ② `current = [msg]` 而不是 `current = []; current.push(msg)`
//      新组的第一条就是触发边界的这条 assistant 消息本身。
//      容易写错成"先把 current 推走、再 push msg" —— 那样 msg 会
//      进到新组里，看似一样，但如果将来在中间加了逻辑就会出问题。
//
//   ③ 循环**结束后**还要 `if (current.length > 0) groups.push(current)`
//      最后那一组没有"下一条消息"来触发它，必须手动收尾。
//      这是所有"按边界切分"循环的固定套路，漏掉就会丢掉最后一组。
  for (const msg of messages) {
    if (
      msg.type === 'assistant' &&
      msg.message.id !== lastAssistantId &&
      current.length > 0
    ) {
      groups.push(current)
      current = [msg]
    } else {
      current.push(msg)
    }
    if (msg.type === 'assistant') {
      lastAssistantId = msg.message.id
    }
  }

  if (current.length > 0) {
    groups.push(current)
  }
  return groups
}
