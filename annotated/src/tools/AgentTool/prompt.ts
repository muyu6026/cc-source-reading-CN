// ═══════════════════════════════════════════════════════════════
// 第 7 步 · 2/4 —— Agent 工具的提示词（src/tools/AgentTool/prompt.ts）
//
// 前面 coordinatorMode.ts 是"协调者自己的提示词"，这个文件是
// "Agent 工具的描述"—— 也就是模型每次看到工具箱时，关于"派活"这件事
// 读到的全部文本。
//
// 【这个文件只有 287 行，但它决定了三件大事】
//
//   ① agent 清单**放在哪里**（工具描述里 or 单独的 attachment 里）
//      → 这是纯粹的成本问题，牵涉到 10.2% 的缓存创建 token（第 53 行）
//   ② fork 门开着还是关着，提示词会长成两个完全不同的形状
//   ③ coordinator 模式拿**精简版**，普通模式拿完整版
//
// 【读之前先分清三个"给谁看"】
//
//   getToolsDescription()  给**模型**看：这个 agent 能用哪些工具
//   formatAgentLine()      给**模型**看：一行一个 agent 的清单
//   getPrompt()            给**模型**看：整段工具描述
//
// 没有一行是给人看的。所以判断"这段文字写得好不好"的标准不是可读性，
// 而是"模型读完会不会做对决定"。这解释了后面很多看起来啰嗦的段落。
// ═══════════════════════════════════════════════════════════════
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getSubscriptionType } from '../../utils/auth.js'
import { hasEmbeddedSearchTools } from '../../utils/embeddedTools.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../utils/envUtils.js'
import { isTeammate } from '../../utils/teammate.js'
import { isInProcessTeammate } from '../../utils/teammateContext.js'
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../GlobTool/prompt.js'
import { SEND_MESSAGE_TOOL_NAME } from '../SendMessageTool/constants.js'
import { AGENT_TOOL_NAME } from './constants.js'
import { isForkSubagentEnabled } from './forkSubagent.js'
import type { AgentDefinition } from './loadAgentsDir.js'

// ─────────────────────────────────────────────────────────────
// 【一个"必须和运行时逻辑保持一致"的展示函数】
//
// agent 定义里有两种工具声明方式：
//   tools            白名单（只有这些能用）
//   disallowedTools  黑名单（除了这些都能用）
//
// 两个都写的时候，第 21 行注释点破了关键："filter allowlist by denylist
// to match runtime behavior"。也就是说运行时是**先取白名单再扣黑名单**，
// 而不是"白名单优先"或"报错"。
//
// 为什么展示函数要精确复刻这个？
// 假设 agent 定义写 tools: [Read, Write]，disallowedTools: [Write]。
//   · 如果提示词说"可用：Read, Write"，模型会派一个需要写文件的任务
//     → 运行时被拒 → 白费一轮
//   · 如果提示词说"可用：Read"，模型就知道这个 agent 只能读
// 所以 effectiveTools 那一行不是美化，是把运行时的真实结果**提前告知**。
//
// 这类"展示与实现分处两个文件、必须人工同步"的地方是最容易漂移的。
// 这里靠一句注释维系，没有测试能覆盖（因为展示是字符串拼接）。
function getToolsDescription(agent: AgentDefinition): string {
  const { tools, disallowedTools } = agent
  const hasAllowlist = tools && tools.length > 0
  const hasDenylist = disallowedTools && disallowedTools.length > 0

  if (hasAllowlist && hasDenylist) {
    // Both defined: filter allowlist by denylist to match runtime behavior
    const denySet = new Set(disallowedTools)
    const effectiveTools = tools.filter(t => !denySet.has(t))
    if (effectiveTools.length === 0) {
      return 'None'
    }
    return effectiveTools.join(', ')
  } else if (hasAllowlist) {
    // Allowlist only: show the specific tools available
    return tools.join(', ')
  } else if (hasDenylist) {
    // Denylist only: show "All tools except X, Y, Z"
    return `All tools except ${disallowedTools.join(', ')}`
  }
  // No restrictions
  return 'All tools'
}

// ─────────────────────────────────────────────────────────────
// 【一行一个 agent 的格式】
//
//   - <agentType>: <whenToUse> (Tools: <工具描述>)
//
// 三个字段各有用途：
//   agentType    模型要填进 subagent_type 参数的值 —— 必须精确
//   whenToUse    什么时候该用 —— 决定"选不选它"
//   Tools        它能干什么 —— 决定"派给它什么范围的活"
//
// 顺序是刻意的：先给标识（要填的参数），再给判断依据（何时用），
// 最后给能力边界。如果反过来，模型读到"能改文件"可能就先入为主，
// 而忽略了 whenToUse 里写的"只用于格式化"这种限定。
/**
 * Format one agent line for the agent_listing_delta attachment message:
 * `- type: whenToUse (Tools: ...)`.
 */
export function formatAgentLine(agent: AgentDefinition): string {
  const toolsDescription = getToolsDescription(agent)
  return `- ${agent.agentType}: ${agent.whenToUse} (Tools: ${toolsDescription})`
}

// ─────────────────────────────────────────────────────────────
// 【全文件最有价值的一段注释：一个 10.2% 的成本数字】
//
// 原注释（第 53-55 行）：
//   "The dynamic agent list was ~10.2% of fleet cache_creation tokens:
//    MCP async connect, /reload-plugins, or permission-mode changes
//    mutate the list -> description changes -> full tool-schema cache bust."
//
// 拆开看这条因果链：
//
//   ① agent 清单是动态的 —— MCP 异步连上服务器会多出 agent、
//      /reload-plugins 会换掉一批、切权限模式会改变可见性
//   ② 这份清单原本**内联在 Agent 工具的描述里**
//   ③ 工具描述属于工具 schema，而 schema 在 API 请求里位于
//      **系统提示词之前**（tools 块 → system 块 → messages 块）
//   ④ 于是清单变一个字 → 工具 schema 变 → 它后面所有内容的缓存前缀全废
//   ⑤ 而在一个 MCP 服务器几十秒才连上的会话里，这件事
//      在开头几分钟内会反复发生
//
// 结果：全公司（fleet）范围内，**光是"重新创建缓存"这一项开销的 10.2%
// 来自这份不断变化的 agent 清单**。不是 10.2% 的 token 消耗，
// 是 10.2% 的 cache_creation token —— 也就是按全价计费的那部分。
//
// 【解法：把动态内容挪出工具描述】
// 改成通过 attachment（agent_listing_delta）注入到**消息流**里。
// 消息流在请求的最末尾，它变化不影响前面任何缓存。
// 工具描述从此变成静态字符串（第 197 行那句 "Available agent types are
// listed in <system-reminder> messages in the conversation."）。
//
// 这个模式和 prompts.ts 里的 SYSTEM_PROMPT_DYNAMIC_BOUNDARY、
// claude.ts 里的 deferred_tools_delta / mcp_instructions_delta
// 是**同一个手法的第三次出现**：
//   把"会变的东西"从"前缀"移到"后缀"。
// 在 prompt cache 的世界里，这是一条几乎无成本的性能优化，
// 代价只是模型要多读一条 attachment。
/**
 * Whether the agent list should be injected as an attachment message instead
 * of embedded in the tool description. When true, getPrompt() returns a static
 * description and attachments.ts emits an agent_listing_delta attachment.
 *
 * The dynamic agent list was ~10.2% of fleet cache_creation tokens: MCP async
 * connect, /reload-plugins, or permission-mode changes mutate the list →
 * description changes → full tool-schema cache bust.
 *
 * Override with CLAUDE_CODE_AGENT_LIST_IN_MESSAGES=true/false for testing.
 */
// 三级开关，优先级从高到低：
//   ① 环境变量为真   → 强制开（给测试用）
//   ② 环境变量为假   → 强制关（给测试用）
//   ③ GrowthBook 门  → 线上灰度
//
// 注意第 61 行用的是 isEnvDefinedFalsy 而不是 !isEnvTruthy —— 这两个
// 不是一回事：
//   · isEnvTruthy('0')      → false
//   · isEnvDefinedFalsy('0')→ true（显式设成了假值）
//   · isEnvDefinedFalsy(undefined) → false（没设）
// 用后者才能区分"没设"和"设成 0"，前者会把两者混为一谈，
// 导致环境变量写 '0' 时反而掉进 GrowthBook 分支。
//
// 【函数名里的 _CACHED_MAY_BE_STALE 值得单独说】
// 这是 GrowthBook 读取的一个约定后缀：这个值来自本地磁盘缓存，
// 可能是上一次会话写下的，**不保证是最新的**。
// 名字把这个缺陷写进了 API —— 调用方一眼就知道"这不是实时配置"。
// 在这种"读一次就决定整个会话行为"的场景里，这个提醒是必要的。
export function shouldInjectAgentListInMessages(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES)) return true
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES))
    return false
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_agent_list_attach', false)
}

// ─────────────────────────────────────────────────────────────
// 【三个入参，各自对应一种"收窄"】
//
//   agentDefinitions    可用的 agent 全集（来自 .claude/agents/ 等目录）
//   isCoordinator       是否协调者模式 —— 决定给精简版还是完整版
//   allowedAgentTypes   Agent(x,y) 语法限定只允许这几种 —— 决定可见子集
//
// 第三个参数是一个容易被忽略的安全机制：权限规则允许用户配置
// "只允许调 code-reviewer 这一种 agent"。这时工具描述里就**不该出现**
// 其他 agent 的名字 —— 否则模型会尝试调用一个注定被拒的类型，
// 白烧一轮，而且用户会看到一条莫名其妙的权限错误。
export async function getPrompt(
  agentDefinitions: AgentDefinition[],
  isCoordinator?: boolean,
  allowedAgentTypes?: string[],
): Promise<string> {
  // Filter agents by allowed types when Agent(x,y) restricts which agents can be spawned
  const effectiveAgents = allowedAgentTypes
    ? agentDefinitions.filter(a => allowedAgentTypes.includes(a.agentType))
    : agentDefinitions

// fork 门决定了这个函数后面**四段内容的有无**：
//
//   whenToForkSection      有 fork 才有（第 80 行）
//   writingThePromptSection 有无 fork 时措辞不同（第 103、110 行）
//   whenNotToUseSection    有 fork 时**整段删掉**（第 232 行）
//   examples               两套完全不同的例子（第 286 行）
//
// 为什么"何时不该用 Agent"这一段在 fork 模式下要删掉？
// 因为那段说的是"如果你只是想读一个文件，别派 agent，自己用 Read"。
// 而 fork 的整个卖点恰恰相反：**派个 fork 去做，因为它共享你的缓存，
// 便宜**。两条建议直接冲突，必须二选一。
//
// 这是提示词工程里很典型的一类问题：**旧规则和新特性打架时，
// 不是加一句"但 fork 除外"，而是整段移除**。
// 因为模型对"例外"的处理远不如对"不存在的规则"干净。
  // Fork subagent feature: when enabled, insert the "When to fork" section
  // (fork semantics, directive-style prompts) and swap in fork-aware examples.
  const forkEnabled = isForkSubagentEnabled()

  const whenToForkSection = forkEnabled
    ? `

## When to fork

Fork yourself (omit \`subagent_type\`) when the intermediate tool output isn't worth keeping in your context. The criterion is qualitative \u2014 "will I need this output again" \u2014 not task size.
- **Research**: fork open-ended questions. If research can be broken into independent questions, launch parallel forks in one message. A fork beats a fresh subagent for this \u2014 it inherits context and shares your cache.
- **Implementation**: prefer to fork implementation work that requires more than a couple of edits. Do research before jumping to implementation.

Forks are cheap because they share your prompt cache. Don't set \`model\` on a fork \u2014 a different model can't reuse the parent's cache. Pass a short \`name\` (one or two words, lowercase) so the user can see the fork in the teams panel and steer it mid-run.

**Don't peek.** The tool result includes an \`output_file\` path — do not Read or tail it unless the user explicitly asks for a progress check. You get a completion notification; trust it. Reading the transcript mid-flight pulls the fork's tool noise into your context, which defeats the point of forking.

**Don't race.** After launching, you know nothing about what the fork found. Never fabricate or predict fork results in any format — not as prose, summary, or structured output. The notification arrives as a user-role message in a later turn; it is never something you write yourself. If the user asks a follow-up before the notification lands, tell them the fork is still running — give status, not a guess.

**Writing a fork prompt.** Since the fork inherits your context, the prompt is a *directive* — what to do, not what the situation is. Be specific about scope: what's in, what's out, what another agent is handling. Don't re-explain background.
`
    : ''
// ─────────────────────────────────────────────────────────────
// 【"怎么写简报"这一段，是全文对模型行为影响最大的部分】
//
// 核心比喻在第 103 行："Brief the agent like a smart colleague who just
// walked into the room"（像给一个刚走进房间的聪明同事交代事情）。
//
// 这个比喻解决了三个隐含问题，一句话全带到了：
//   "smart"      → 不需要手把手教它怎么做，给目标就行
//   "just walked in" → 它不知道前情，必须交代背景
//   "colleague"  → 平级协作，不是下命令，可以给判断空间
//
// 后面五条要点是把这个比喻拆成可执行的检查项，其中第 108 行
// 有一条很精妙的分工：
//   "Lookups: hand over the exact command."
//   "Investigations: hand over the question — prescribed steps become
//    dead weight when the premise is wrong."
// （查东西：给准确命令。查问题：给问题本身 —— 如果前提就错了，
//   你规定的步骤全是废动作。）
//
// 这条区分抓住了"委派"的本质：**确定性任务给步骤，不确定性任务给目标**。
// 给反了的后果是不对称的 —— 查文件给了模糊目标只是慢一点；
// 查 bug 给了具体步骤则会在前提错误时让 worker 一条道走到黑。

  const writingThePromptSection = `

## Writing the prompt

${forkEnabled ? 'When spawning a fresh agent (with a `subagent_type`), it starts with zero context. ' : ''}Brief the agent like a smart colleague who just walked into the room — it hasn't seen this conversation, doesn't know what you've tried, doesn't understand why this task matters.
- Explain what you're trying to accomplish and why.
- Describe what you've already learned or ruled out.
- Give enough context about the surrounding problem that the agent can make judgment calls rather than just following a narrow instruction.
- If you need a short response, say so ("report in under 200 words").
- Lookups: hand over the exact command. Investigations: hand over the question — prescribed steps become dead weight when the premise is wrong.

${forkEnabled ? 'For fresh agents, terse' : 'Terse'} command-style prompts produce shallow, generic work.

**Never delegate understanding.** Don't write "based on your findings, fix the bug" or "based on the research, implement it." Those phrases push synthesis onto the agent instead of doing it yourself. Write prompts that prove you understood: include file paths, line numbers, what specifically to change.
`
// ─────────────────────────────────────────────────────────────
// 【fork 模式的三个示例，每个都在示范一种"不该做的事"的反面】
//
// 示例一（117-131）：一个普通的"分支还剩什么没做完"的审计任务。
//   关键在 <commentary> 里那句：
//     "Turn ends here. The coordinator knows nothing about the findings yet.
//      What follows is a SEPARATE turn."
//   （轮次在这里结束。协调者对结果一无所知。下面是**另一个**轮次。）
//   这是在教模型"派完活就闭嘴"，不要在同一轮里编造结果。
//
// 示例二（133-139）：**用户中途追问**。
//   "so is the gate wired up or not" —— 而审计还没回来。
//   正确反应："Still waiting on the audit — that's one of the things
//   it's checking. Should land shortly."
//   （还在等审计 —— 这正是它在查的项之一，应该快了。）
//   这个例子的价值在于它示范了"给状态，不给猜测"。
//   模型在这里的默认倾向是危险的：它知道用户想听"是"，而它又记得
//   自己派了个审计，于是很容易顺口编一个"是的，接好了"。
//
// 示例三（141-153）：显式指定 subagent_type 的场合。
//   <thinking> 里写"I'll ask the code-reviewer agent — it won't see my
//   analysis, so it can give an independent read."
//   （它看不到我的分析，所以能得到独立判断。）
//   这是 fork 与 fresh agent 的**本质区别**在业务上的体现：
//   要独立意见时必须新开，因为 fork 会继承你的结论、被你的结论带偏。
//
// 三个例子分别覆盖：正常派活 / 派活后被打断 / 为什么这次不 fork。
// 覆盖得相当完整，不是随手凑的。

  const forkExamples = `Example usage:

<example>
user: "What's left on this branch before we can ship?"
assistant: <thinking>Forking this \u2014 it's a survey question. I want the punch list, not the git output in my context.</thinking>
${AGENT_TOOL_NAME}({
  name: "ship-audit",
  description: "Branch ship-readiness audit",
  prompt: "Audit what's left before this branch can ship. Check: uncommitted changes, commits ahead of main, whether tests exist, whether the GrowthBook gate is wired up, whether CI-relevant files changed. Report a punch list \u2014 done vs. missing. Under 200 words."
})
assistant: Ship-readiness audit running.
<commentary>
Turn ends here. The coordinator knows nothing about the findings yet. What follows is a SEPARATE turn \u2014 the notification arrives from outside, as a user-role message. It is not something the coordinator writes.
</commentary>
[later turn \u2014 notification arrives as user message]
assistant: Audit's back. Three blockers: no tests for the new prompt path, GrowthBook gate wired but not in build_flags.yaml, and one uncommitted file.
</example>

<example>
user: "so is the gate wired up or not"
<commentary>
User asks mid-wait. The audit fork was launched to answer exactly this, and it hasn't returned. The coordinator does not have this answer. Give status, not a fabricated result.
</commentary>
assistant: Still waiting on the audit \u2014 that's one of the things it's checking. Should land shortly.
</example>

<example>
user: "Can you get a second opinion on whether this migration is safe?"
assistant: <thinking>I'll ask the code-reviewer agent — it won't see my analysis, so it can give an independent read.</thinking>
<commentary>
A subagent_type is specified, so the agent starts fresh. It needs full context in the prompt. The briefing explains what to assess and why.
</commentary>
${AGENT_TOOL_NAME}({
  name: "migration-review",
  description: "Independent migration review",
  subagent_type: "code-reviewer",
  prompt: "Review migration 0042_user_schema.sql for safety. Context: we're adding a NOT NULL column to a 50M-row table. Existing rows get a backfill default. I want a second opinion on whether the backfill approach is safe under concurrent writes — I've checked locking behavior but want independent verification. Report: is this safe, and if not, what specifically breaks?"
})
</example>
`
// ─────────────────────────────────────────────────────────────
// 【非 fork 模式的例子：注意它有多"朴素"】
//
// 两个例子：写个素数函数 → 派 test-runner 跑测试；用户说"你好" →
// 派 greeting-responder 讲个笑话。
//
// 第二个例子明显是个教学用的假 agent（greeting-responder），
// 目的是让模型看懂"agent 定义里的 whenToUse 说了什么时候用，
// 你就什么时候用"这个映射关系。
//
// 【两套例子的差别值得注意】
// fork 版例子是**真实工作流**（审计分支、等通知、独立评审），
// 非 fork 版例子是**语法示范**（写明参数、写明什么时候触发）。
// 前者教"节奏"，后者教"格式"。
//
// 这个差别不是水平问题，而是两种模式的失败面不同：
//   · fork 模式最容易出的错是"抢答"和"偷看输出文件"→ 要教节奏
//   · 普通模式最容易出的错是"该派不派"和"参数写错"→ 要教格式

  const currentExamples = `Example usage:

<example_agent_descriptions>
"test-runner": use this agent after you are done writing code to run tests
"greeting-responder": use this agent to respond to user greetings with a friendly joke
</example_agent_descriptions>

<example>
user: "Please write a function that checks if a number is prime"
assistant: I'm going to use the ${FILE_WRITE_TOOL_NAME} tool to write the following code:
<code>
function isPrime(n) {
  if (n <= 1) return false
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false
  }
  return true
}
</code>
<commentary>
Since a significant piece of code was written and the task was completed, now use the test-runner agent to run the tests
</commentary>
assistant: Uses the ${AGENT_TOOL_NAME} tool to launch the test-runner agent
</example>

<example>
user: "Hello"
<commentary>
Since the user is greeting, use the greeting-responder agent to respond with a friendly joke
</commentary>
assistant: "I'm going to use the ${AGENT_TOOL_NAME} tool to launch the greeting-responder agent"
</example>
`

  // When the gate is on, the agent list lives in an agent_listing_delta
  // attachment (see attachments.ts) instead of inline here. This keeps the
  // tool description static across MCP/plugin/permission changes so the
  // tools-block prompt cache doesn't bust every time an agent loads.
  const listViaAttachment = shouldInjectAgentListInMessages()

  const agentListSection = listViaAttachment
    ? `Available agent types are listed in <system-reminder> messages in the conversation.`
    : `Available agent types and the tools they have access to:
${effectiveAgents.map(agent => formatAgentLine(agent)).join('\n')}`
// 【同一份清单的两种呈现方式，只差一句话】
//
//   走 attachment：`Available agent types are listed in <system-reminder>
//                   messages in the conversation.`
//   内联：         `Available agent types and the tools they have access to:`
//                  + 逐行 formatAgentLine
//
// 注意走 attachment 时那句措辞 —— 它不只是省略，而是**告诉模型去哪里找**。
// 如果只写 "Available agent types are listed separately"，模型可能
// 不知道 "separately" 指什么，然后在派活时瞎猜 agentType。
// 明确点出 `<system-reminder>` 这个标签名，模型才能在消息里定位到它。
//
// 这也是本文档反复出现的一个模式：**移除内容时必须留下指针**。
// 前面 coordinatorMode.ts 里 task-notification 靠标签名区分真假用户消息，
// 这里靠标签名定位被挪走的清单 —— 结构化的标签本身就是协议。

  // Shared core prompt used by both coordinator and non-coordinator modes
  const shared = `Launch a new agent to handle complex, multi-step tasks autonomously.

The ${AGENT_TOOL_NAME} tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

${agentListSection}

${
  forkEnabled
    ? `When using the ${AGENT_TOOL_NAME} tool, specify a subagent_type to use a specialized agent, or omit it to fork yourself — a fork inherits your full conversation context.`
    : `When using the ${AGENT_TOOL_NAME} tool, specify a subagent_type parameter to select which agent type to use. If omitted, the general-purpose agent is used.`
}`
// ─────────────────────────────────────────────────────────────
// 【协调者模式只拿 shared 这一小段，其余全部不要】
//
// shared 里有什么：一句话说明 Agent 工具干什么 + agent 清单 +
// 一句"要指定 subagent_type / 或者省略以 fork"。
//
// 砍掉了什么：
//   · "When NOT to use" 整段
//   · Usage notes 八条（含并发提示、后台运行、worktree 隔离、参数限制）
//   · fork 的全部说明与例子
//
// 【为什么砍得这么狠】
// 因为协调者的**系统提示词**（coordinatorMode.ts 里那 258 行）已经把
// 这些全部讲过了，而且讲得更针对 —— 它讲的是"如何指挥"而不是
// "这个工具怎么用"。
//
// 重复的代价不只是 token。两处描述同一件事时，一旦措辞有细微差别，
// 模型会在两个版本之间摇摆。比如这里说"launch multiple agents
// concurrently whenever possible"，系统提示词说"写重任务一次只能一个" ——
// 分开看都对，一起看就是矛盾。
//
// 所以规则是：**同一件事只在一个地方说，另一个地方直接不出现**。
// 这和前面"fork 模式下删掉 whenNotToUse"是同一条原则的两次应用。

  // Coordinator mode gets the slim prompt -- the coordinator system prompt
  // already covers usage notes, examples, and when-not-to-use guidance.
  if (isCoordinator) {
    return shared
  }

// ─────────────────────────────────────────────────────────────
// 【内部构建的一个特化：find/grep 被别名进了 Bash】
//
// ant 内部构建把 bfs / ugrep 嵌进二进制，并用 shell 别名把
// find / grep 指向它们，同时**移除了独立的 Glob / Grep 工具**。
//
// 于是提示词不能再说"用 Glob 工具找文件"—— 那个工具不存在。
// 得改成"用 Bash 跑 find"。
//
// 注意第 229-231 行的注释解释了一个细节：
//   "The 'class Foo' example is about content search. Non-embedded stays Glob
//    (original intent: find-the-file-containing). Embedded gets grep because
//    find -name doesn't look at file contents."
//
// 也就是说：非嵌入版这里本该用 Grep 工具，但历史上写的是 Glob
// （因为原意是"找哪个文件里包含这个类"），而 Glob 也能找到文件，
// 所以这个错一直没暴露。嵌入版反而用了正确的 grep。
//
// 【这个细节说明什么】
// 提示词里的工具名一旦写错，**不会报错，也不会被测试发现** ——
// 模型会自己去试，试不通就换个方式，用户完全看不到。
// 这类"静默降级"在提示词里是常态，也是它比代码更难维护的原因。
  // Ant-native builds alias find/grep to embedded bfs/ugrep and remove the
  // dedicated Glob/Grep tools, so point at find via Bash instead.
  const embedded = hasEmbeddedSearchTools()
  const fileSearchHint = embedded
    ? '`find` via the Bash tool'
    : `the ${GLOB_TOOL_NAME} tool`
  // The "class Foo" example is about content search. Non-embedded stays Glob
  // (original intent: find-the-file-containing). Embedded gets grep because
  // find -name doesn't look at file contents.
  const contentSearchHint = embedded
    ? '`grep` via the Bash tool'
    : `the ${GLOB_TOOL_NAME} tool`
  const whenNotToUseSection = forkEnabled
    ? ''
    : `
When NOT to use the ${AGENT_TOOL_NAME} tool:
- If you want to read a specific file path, use the ${FILE_READ_TOOL_NAME} tool or ${fileSearchHint} instead of the ${AGENT_TOOL_NAME} tool, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use ${contentSearchHint} instead, to find the match more quickly
- If you are searching for code within a specific file or set of 2-3 files, use the ${FILE_READ_TOOL_NAME} tool instead of the ${AGENT_TOOL_NAME} tool, to find the match more quickly
- Other tasks that are not related to the agent descriptions above
`

// 【一句按订阅档位区分的话，背后的理由值得推敲】
//
// 内容是："能并发就并发，一条消息里发多个 tool_use"。
// 条件是：getSubscriptionType() !== 'pro'。
//
// 为什么唯独把 Pro 排除？
// 官方没有写理由（这里也没注释）。从系统行为推断：
// 并发派多个 agent 会**同时**占用多份上下文，输入 token 在极短时间内
// 成倍上涨。Pro 档位的额度窗口比其他档位紧，并发更容易撞上限制，
// 撞上之后体验更差（不是慢，是直接被 429 打断）。
//
// 【这个位置暴露了一个提示词工程的普遍困境】
// 提示词是按"用户档位"分支的，但**模型看不到自己的档位**。
// 它只是读到或读不到那句话，无法理解为什么。
// 于是这类"按账号属性裁剪提示词"的代码，永远只能靠外部逻辑
// 拼出正确文本，无法让模型自己适配 —— 这也是为什么 CC 里
// 有那么多 if (getSubscriptionType() ...)、if (isTeammate()) ...
//
// 另一个细节：这段只在**内联清单**时生效（!listViaAttachment）。
// 走 attachment 时，并发提示被移到 attachment 里，并且在那里
// 同样带订阅档位条件。同一句话换了位置但条件不变 —— 这是
// 迁移代码时最容易漏的地方，这里没漏。
  // When listing via attachment, the "launch multiple agents" note is in the
  // attachment message (conditioned on subscription there). When inline, keep
  // the existing per-call getSubscriptionType() check.
  const concurrencyNote =
    !listViaAttachment && getSubscriptionType() !== 'pro'
      ? `
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses`
      : ''
// ─────────────────────────────────────────────────────────────
// 【最后的组装：普通模式拿到的完整结构】
//
//   ① shared                  工具干什么 + agent 清单 + fork 还是 subagent_type
//   ② whenNotToUseSection     什么时候别用（fork 模式下为空）
//   ③ Usage notes 八条         带三个条件插入块：
//        · 并发提示（非 Pro 档 + 内联清单时）
//        · 后台运行说明（未禁用后台任务 + 非进程内 teammate + 未开 fork）
//        · 追加参数限制（isInProcessTeammate / isTeammate 各自不同）
//   ④ whenToForkSection       fork 模式才有
//   ⑤ writingThePromptSection 怎么写简报（两种措辞）
//   ⑥ examples                两套之一
//
// 【第 259-265 行那个三条件判断值得单独看】
//   !CLAUDE_CODE_DISABLE_BACKGROUND_TASKS && !isInProcessTeammate() && !forkEnabled
// 三条缺一不可：
//   · 后台任务被禁用 → 说了 run_in_background 模型会试，然后失败
//   · 进程内 teammate → 它的生命周期绑在 leader 上，开不了后台
//   · fork 模式 → 所有 spawn 本来就是异步的，"要不要后台"不是选项
//
// 【第 277-283 行是一个"按身份改口供"的地方】
// 进程内 teammate 被告知：run_in_background / name / team_name / mode 都不可用。
// tmux teammate 被告知：name / team_name / mode 不可用（不能嵌套建队）。
// 普通主线程：什么都不说（全都可用）。
//
// 这些限制在 AgentTool.tsx 里都有对应的 throw（第 262-280 行）。
// **提示词里说一遍、代码里拦一遍** —— 这是 CC 处理"模型可能不听话"
// 的通用手法，前面 coordinator 的 model 参数也是同一个模式。
// 提示词负责让模型不犯错，代码负责让错误不产生后果。

  // Non-coordinator gets the full prompt with all sections
  return `${shared}
${whenNotToUseSection}

Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do${concurrencyNote}
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.${
    // eslint-disable-next-line custom-rules/no-process-env-top-level
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS) &&
    !isInProcessTeammate() &&
    !forkEnabled
      ? `
- You can optionally run agents in the background using the run_in_background parameter. When an agent runs in the background, you will be automatically notified when it completes — do NOT sleep, poll, or proactively check on its progress. Continue with other work or respond to the user instead.
- **Foreground vs background**: Use foreground (default) when you need the agent's results before you can proceed — e.g., research agents whose findings inform your next steps. Use background when you have genuinely independent work to do in parallel.`
      : ''
  }
- To continue a previously spawned agent, use ${SEND_MESSAGE_TOOL_NAME} with the agent's ID or name as the \`to\` field. The agent resumes with its full context preserved. ${forkEnabled ? 'Each fresh Agent invocation with a subagent_type starts without context — provide a complete task description.' : 'Each Agent invocation starts fresh — provide a complete task description.'}
- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.)${forkEnabled ? '' : ", since it is not aware of the user's intent"}
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.
- If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple ${AGENT_TOOL_NAME} tool use content blocks. For example, if you need to launch both a build-validator agent and a test-runner agent in parallel, send a single message with both tool calls.
- You can optionally set \`isolation: "worktree"\` to run the agent in a temporary git worktree, giving it an isolated copy of the repository. The worktree is automatically cleaned up if the agent makes no changes; if changes are made, the worktree path and branch are returned in the result.${
    process.env.USER_TYPE === 'ant'
      ? `\n- You can set \`isolation: "remote"\` to run the agent in a remote CCR environment. This is always a background task; you'll be notified when it completes. Use for long-running tasks that need a fresh sandbox.`
      : ''
  }${
    isInProcessTeammate()
      ? `
- The run_in_background, name, team_name, and mode parameters are not available in this context. Only synchronous subagents are supported.`
      : isTeammate()
        ? `
- The name, team_name, and mode parameters are not available in this context — teammates cannot spawn other teammates. Omit them to spawn a subagent.`
        : ''
  }${whenToForkSection}${writingThePromptSection}

${forkEnabled ? forkExamples : currentExamples}`
}
