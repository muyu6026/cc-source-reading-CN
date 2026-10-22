/**
 * Periodic background summarization for coordinator mode sub-agents.
 *
 * Forks the sub-agent's conversation every ~30s using runForkedAgent()
 * to generate a 1-2 sentence progress summary. The summary is stored
 * on AgentProgress for UI display.
 *
 * Cache sharing: uses the same CacheSafeParams as the parent agent
 * to share the prompt cache. Tools are kept in the request for cache
 * key matching but denied via canUseTool callback.
 */

import type { TaskContext } from '../../Task.js'
import { updateAgentSummary } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { filterIncompleteToolCalls } from '../../tools/AgentTool/runAgent.js'
import type { AgentId } from '../../types/ids.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  type CacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import { createUserMessage } from '../../utils/messages.js'
import { getAgentTranscript } from '../../utils/sessionStorage.js'

const SUMMARY_INTERVAL_MS = 30_000
// 模块定位：给**协调器模式下的子代理**做「一行进度条」。每隔 30 秒 fork 一次子代理的对话，让它用 3-5 个词描述自己刚才在干什么（现在分词），结果写进 `AgentProgress` 供 UI 显示。它是「后台 fork」这一族的第四种用法：`extractMemories` 抽记忆、`autoDream` 整理记忆、`MagicDocs` 维护文档，这个**做状态播报**——唯一一个产物是给人看的短句、不写任何文件的。

// prompt 的设计是这份文件最值得抄的地方：**限定词数（3-5）、限定语态（现在分词）、限定命名对象（说文件或函数，不说分支名）**，然后给 4 个 Good 和 4 个 Bad——每个 Bad 都标注了失败类型（过去时 / 太含糊 / 太长 / 说了分支名）。few-shot 里放反例并指出错在哪，比只说「要简洁」有效得多。
function buildSummaryPrompt(previousSummary: string | null): string {
  const prevLine = previousSummary
// 把上一轮的摘要塞回 prompt 并明说 `say something NEW`：定时器是 30 秒一跳，子代理经常在这 30 秒里没干新事——不给这句，UI 上就会连续显示同一行字，看起来像卡住了。
    ? `\nPrevious: "${previousSummary}" — say something NEW.\n`
    : ''

  return `Describe your most recent action in 3-5 words using present tense (-ing). Name the file or function, not the branch. Do not use tools.
${prevLine}
Good: "Reading runAgent.ts"
Good: "Fixing null check in validate.ts"
Good: "Running auth module tests"
Good: "Adding retry logic to fetchUser"

Bad (past tense): "Analyzed the branch diff"
Bad (too vague): "Investigating the issue"
Bad (too long): "Reviewing full branch diff and AgentTool.tsx integration"
Bad (branch name): "Analyzed adam/background-summary branch diff"`
}

export function startAgentSummarization(
  taskId: string,
  agentId: AgentId,
  cacheSafeParams: CacheSafeParams,
  setAppState: TaskContext['setAppState'],
): { stop: () => void } {
  // Drop forkContextMessages from the closure — runSummary rebuilds it each
  // tick from getAgentTranscript(). Without this, the original fork messages
  // (passed from AgentTool.tsx) are pinned for the lifetime of the timer.
  const { forkContextMessages: _drop, ...baseParams } = cacheSafeParams
// 这一行是**内存泄漏的补丁**，注释写得很清楚：`forkContextMessages` 是 AgentTool 传进来的初始 fork 消息数组，如果留在闭包里，它会**在定时器整个生命周期内被钉住**（30 秒一跳、可能几小时），而且内容永远是启动时的旧快照。所以解构时把它显式丢掉，`runSummary` 每次从 `getAgentTranscript()` 重新读最新消息。`_drop` 的命名是「故意不用」的约定。
  let summaryAbortController: AbortController | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let previousSummary: string | null = null

  async function runSummary(): Promise<void> {
    if (stopped) return

    logForDebugging(`[AgentSummary] Timer fired for agent ${agentId}`)

    try {
      // Read current messages from transcript
      const transcript = await getAgentTranscript(agentId)
// **消息少于 3 条就跳过**（一条 user + 一条 assistant 才算一轮，3 条才勉强有「刚才做了什么」可讲）。注意这里 `return` 不等于结束——`finally` 里照样排下一次，所以是「这一跳不干活」，不是「停止播报」。
      if (!transcript || transcript.messages.length < 3) {
        // Not enough context yet — finally block will schedule next attempt
        logForDebugging(
          `[AgentSummary] Skipping summary for ${taskId}: not enough messages (${transcript?.messages.length ?? 0})`,
        )
        return
      }

      // Filter to clean message state
      const cleanMessages = filterIncompleteToolCalls(transcript.messages)
// `filterIncompleteToolCalls` 是必须的：transcript 可能在「assistant 发了 tool_use、tool_result 还没写回」的中间态被读到，直接把这种半截对话当 context 发出去，API 会因 tool_use 没有对应 tool_result 而报错。这一步是把消息裁成**合法的对话状态**。

      // Build fork params with current messages
      const forkParams: CacheSafeParams = {
        ...baseParams,
        forkContextMessages: cleanMessages,
      }

      logForDebugging(
        `[AgentSummary] Forking for summary, ${cleanMessages.length} messages in context`,
      )

      // Create abort controller for this summary
      summaryAbortController = new AbortController()

      // Deny tools via callback, NOT by passing tools:[] - that busts cache
// 拒绝工具用的是 **`canUseTool` 回调**，而不是传 `tools: []`——注释里点明了原因：`tools` 数组是 prompt cache 的 key 的一部分，把它清空等于换了一个缓存 key，主线程刚建好的缓存立刻作废。所以工具定义照发（保住 cache key），只在执行层拒绝。这是「共享 prompt cache」类功能里最容易踩错的一处。
      const canUseTool = async () => ({
        behavior: 'deny' as const,
        message: 'No tools needed for summary',
        decisionReason: { type: 'other' as const, reason: 'summary only' },
      })

      // DO NOT set maxOutputTokens here. The fork piggybacks on the main
      // thread's prompt cache by sending identical cache-key params (system,
      // tools, model, messages prefix, thinking config). Setting maxOutputTokens
      // would clamp budget_tokens, creating a thinking config mismatch that
      // invalidates the cache.
      //
      // ContentReplacementState is cloned by default in createSubagentContext
      // from forkParams.toolUseContext (the subagent's LIVE state captured at
      // onCacheSafeParams time). No explicit override needed.
// 这段注释解释了**为什么参数里看不到任何 token 预算设置**：`maxOutputTokens` 会影响 `budget_tokens`（thinking 配置），而 thinking 配置同样是 cache key 的一部分——一改就从缓存命中变成全量计费。所以这里宁可让摘要模型用默认预算，也不碰任何会影响 key 的参数。同族的 `ContentReplacementState` 也不用显式覆盖：`createSubagentContext` 默认从 `forkParams.toolUseContext` 克隆（那是 `onCacheSafeParams` 时刻捕获的子代理**实时**状态）。
      const result = await runForkedAgent({
        promptMessages: [
          createUserMessage({ content: buildSummaryPrompt(previousSummary) }),
        ],
        cacheSafeParams: forkParams,
        canUseTool,
        querySource: 'agent_summary',
        forkLabel: 'agent_summary',
        overrides: { abortController: summaryAbortController },
// `skipTranscript: true` 让这次 fork 的对话**不写进任何 transcript**。两个作用：① 摘要请求本身不该出现在会话记录里（用户翻历史会看到一堆莫名其妙的「Describe your most recent action」）；② 更关键的是防止自吞——摘要子代理的对话如果被写进子代理 transcript，下一跳读到的消息数就会因为摘要请求而虚增。
        skipTranscript: true,
      })

      if (stopped) return

      // Extract summary text from result
      for (const msg of result.messages) {
        if (msg.type !== 'assistant') continue
        // Skip API error messages
// 跳过 `isApiErrorMessage`：这类消息的 content 里装的是错误文本（限流、超载），如果被当成摘要显示，UI 上就会出现「Reading rate limit error」这种把故障写成进度的鬼东西。
        if (msg.isApiErrorMessage) {
          logForDebugging(
            `[AgentSummary] Skipping API error message for ${taskId}`,
          )
          continue
        }
        const textBlock = msg.message.content.find(b => b.type === 'text')
        if (textBlock?.type === 'text' && textBlock.text.trim()) {
          const summaryText = textBlock.text.trim()
          logForDebugging(
            `[AgentSummary] Summary result for ${taskId}: ${summaryText}`,
          )
          previousSummary = summaryText
          updateAgentSummary(taskId, summaryText, setAppState)
          break
        }
      }
    } catch (e) {
      if (!stopped && e instanceof Error) {
        logError(e)
      }
// 定时器在 **`finally` 里排下一次**，不是在这之前——注释写的是 `Reset timer on completion (not initiation) to prevent overlapping summaries`。如果按固定间隔无条件排下一跳，一旦某次 fork 超过 30 秒（大 transcript 很容易），两个摘要就会同时在跑，后完成的那次覆盖先完成的，UI 上出现时间倒流。
    } finally {
      summaryAbortController = null
      // Reset timer on completion (not initiation) to prevent overlapping summaries
      if (!stopped) {
        scheduleNext()
      }
    }
  }

  function scheduleNext(): void {
    if (stopped) return
    timeoutId = setTimeout(runSummary, SUMMARY_INTERVAL_MS)
// 用 `setTimeout` 递归重排而不是 `setInterval`：间隔从**上一次完成**开始算，天然不会重叠。`unref()` 没加——这是有意的，摘要定时器活着就说明有子代理在跑，主进程本来也不该退出。
  }

// `stop()` 三件事按顺序做：置 `stopped` 标志（让在途的 `runSummary` 在下一个检查点自己退）、清定时器、abort 在途请求。返回值就是这个 `{ stop }`——**调用方必须负责调它**，否则子代理结束后定时器还在跳，一直白烧 token。
  function stop(): void {
    logForDebugging(`[AgentSummary] Stopping summarization for ${taskId}`)
    stopped = true
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (summaryAbortController) {
      summaryAbortController.abort()
      summaryAbortController = null
    }
  }

  // Start the first timer
  scheduleNext()

  return { stop }
}
