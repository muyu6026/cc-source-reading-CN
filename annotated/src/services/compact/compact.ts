// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 服务层 · 4/N —— 压缩本体（src/services/compact/compact.ts）
//
// `autoCompact.ts` 决定"什么时候压"，这个文件决定"怎么压"。
// 1,705 行，是全代码库最长的非 API 文件之一。
//
// 【先建立一个反直觉的认知：压缩本身就是一次完整的 API 调用】
//
// 很多人以为压缩是"本地把旧消息删掉"。不是。压缩 = 把旧消息发给模型，
// 让它写一份摘要，然后**用摘要替换掉旧消息**。这意味着压缩会：
//   · 花钱（一次输入 = 整个上下文）
//   · 花时间（实测 5-10 秒，长会话更久）
//   · 失败（网络、限流、模型抽风）
//   · **自己也会 prompt-too-long**（因为它的输入就是那个已经太长了的上下文）
//
// 最后一条是这个文件一半复杂度的来源。行 243 的 truncateHeadForPTLRetry
// 就是给"压缩请求自己撞上上下文上限"准备的逃生舱（内部编号 CC-1180）。
//
// 【这个文件的结构，读之前先建立框架】
//
//   ① 预处理        145 stripImagesFromMessages
//                   211 stripReinjectedAttachments
//                   ——压缩前先减肥，把对摘要没用的东西剔掉
//   ② PTL 逃生舱    243 truncateHeadForPTLRetry
//                   ——压缩请求自己超长时，砍掉最老的几轮重试
//   ③ 全量压缩      387 compactConversation（376 行）
//                   ——压掉全部历史，只留摘要
//   ④ 局部压缩      772 partialCompactConversation（335 行）
//                   ——只压一半，另一半原样保留（用户手选分界点）
//   ⑤ 摘要生成      1136 streamCompactSummary（261 行）
//                   ——真正发那次 API 调用，两条路径（复用缓存 / 普通流式）
//   ⑥ 压缩后重建    1415 起一串 createXxxAttachment
//                   ——把压缩丢掉的东西补回来（文件、技能、plan、agent…）
//
// 【这个文件真正在解决的问题，不是"怎么变短"】
//
// 而是"变短之后怎么不丢东西"。压缩会连带丢掉：
//   · 读过的文件内容（模型得重新 Read）
//   · 调用过的技能说明（guidelines 没了）
//   · 当前 plan 文件
//   · 后台还在跑的 agent 列表（不补回去会重复 spawn）
//   · plan mode 的状态（不补回去模型会开始直接改代码）
//   · 延迟加载的 MCP 工具清单和指令
//   · 已加载的 deferred tool schema（tool_reference 块不在摘要里）
//
// 所以第 ⑥ 段有七个 createXxxAttachment。**压缩的真实成本不是 token，
// 是这些信息损失**——每补一项都是几十到几千 token 的 cache_creation。
// ═══════════════════════════════════════════════════════════════
import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import uniqBy from 'lodash-es/uniqBy.js'

/* eslint-disable @typescript-eslint/no-require-imports */
// 又是 `feature('KAIROS') ? require(...) : null` 的条件导入。
//
// 和第 5 步 prompts.ts 里讲过的 DCE 机制完全一样：`feature()` 是构建期常量，
// 打包器看到 `false ? require(A) : null` 会把整个 require 连同 A 的模块图删掉。
// 所以 `sessionTranscriptModule` 在外部构建里恒为 null，下面所有
// `sessionTranscriptModule?.xxx` 都变成 `null?.xxx` → undefined → 无操作。
//
// 注意它上面那行 `/* eslint-disable @typescript-eslint/no-require-imports */`
// 和下面 82 行的 eslint-enable 把整个 import 区夹住了。原因是这个文件里
// 有一堆 `import` 被这个 require 打断了顺序——eslint 的 import 规则会报错，
// 只能整段关掉。
//
// 【顺带一个读源码的经验】
// 看到 `const X = feature('Y') ? require(...) : null` 就知道：
// 这个模块在开源版里**不存在**。不要试图去 src/ 下面找它，
// 找到了也是残缺的。后面凡是 `X?.` 的调用，外部构建里全是空转。
const sessionTranscriptModule = feature('KAIROS')
  ? (require('../sessionTranscript/sessionTranscript.js') as typeof import('../sessionTranscript/sessionTranscript.js'))
  : null

import { APIUserAbortError } from '@anthropic-ai/sdk'
import { markPostCompaction } from 'src/bootstrap/state.js'
import { getInvokedSkillsForAgent } from '../../bootstrap/state.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { FileReadTool } from '../../tools/FileReadTool/FileReadTool.js'
import {
  FILE_READ_TOOL_NAME,
  FILE_UNCHANGED_STUB,
} from '../../tools/FileReadTool/prompt.js'
import { ToolSearchTool } from '../../tools/ToolSearchTool/ToolSearchTool.js'
import type { AgentId } from '../../types/ids.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  HookResultMessage,
  Message,
  PartialCompactDirection,
  SystemCompactBoundaryMessage,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import {
  createAttachmentMessage,
  generateFileAttachment,
  getAgentListingDeltaAttachment,
  getDeferredToolsDeltaAttachment,
  getMcpInstructionsDeltaAttachment,
} from '../../utils/attachments.js'
import { getMemoryPath } from '../../utils/config.js'
import { COMPACT_MAX_OUTPUT_TOKENS } from '../../utils/context.js'
import {
  analyzeContext,
  tokenStatsToStatsigMetrics,
} from '../../utils/contextAnalysis.js'
import { logForDebugging } from '../../utils/debug.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import { cacheToObject } from '../../utils/fileStateCache.js'
import {
  type CacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import {
  executePostCompactHooks,
  executePreCompactHooks,
} from '../../utils/hooks.js'
import { logError } from '../../utils/log.js'
import { MEMORY_TYPE_VALUES } from '../../utils/memory/types.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
  getAssistantMessageText,
  getLastAssistantMessage,
  getMessagesAfterCompactBoundary,
  isCompactBoundaryMessage,
  normalizeMessagesForAPI,
} from '../../utils/messages.js'
import { expandPath } from '../../utils/path.js'
import { getPlan, getPlanFilePath } from '../../utils/plans.js'
import {
  isSessionActivityTrackingActive,
  sendSessionActivitySignal,
} from '../../utils/sessionActivity.js'
import { processSessionStartHooks } from '../../utils/sessionStart.js'
import {
  getTranscriptPath,
  reAppendSessionMetadata,
} from '../../utils/sessionStorage.js'
import { sleep } from '../../utils/sleep.js'
import { jsonStringify } from '../../utils/slowOperations.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { getTaskOutputPath } from '../../utils/task/diskOutput.js'
import {
  getTokenUsage,
  tokenCountFromLastAPIResponse,
  tokenCountWithEstimation,
} from '../../utils/tokens.js'
import {
  extractDiscoveredToolNames,
  isToolSearchEnabled,
} from '../../utils/toolSearch.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  getMaxOutputTokensForModel,
  queryModelWithStreaming,
} from '../api/claude.js'
import {
  getPromptTooLongTokenGap,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  startsWithApiErrorPrefix,
} from '../api/errors.js'
import { notifyCompaction } from '../api/promptCacheBreakDetection.js'
import { getRetryDelay } from '../api/withRetry.js'
import { logPermissionContextForAnts } from '../internalLogging.js'
import {
  roughTokenCountEstimation,
  roughTokenCountEstimationForMessages,
} from '../tokenEstimation.js'
import { groupMessagesByApiRound } from './grouping.js'
import {
  getCompactPrompt,
  getCompactUserSummaryMessage,
  getPartialCompactPrompt,
} from './prompt.js'

// ═══ 压缩后的预算常量 ═══
//
// 三个数字配在一起看：
//   最多恢复 5 个文件 × 每文件最多 5,000 token = 25,000
//   总预算 50,000
//
// 为什么总额是 25,000 的两倍？因为这两个限制是**两道独立的闸**，
// 不是乘除法关系：
//   · MAX_FILES 控制"恢复几个"——防止一口气恢复 50 个文件
//   · TOKEN_BUDGET 控制"总共占多少"——防止 5 个超大文件把预算吃光
//
// 单个文件 5,000 token 已经不小了（约 20KB 文本）。5 个就是 25K，
// 而压缩后的上下文整体可能只有 20-30K——也就是说**附件可能比摘要本身还大**。
// 这不是 bug：摘要说的是"我们聊了什么"，附件说的是"需要哪些原材料"，
// 后者对继续工作更关键。
export const POST_COMPACT_MAX_FILES_TO_RESTORE = 5
export const POST_COMPACT_TOKEN_BUDGET = 50_000
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000
// 这段注释记的是一次真实的回归事故，值得逐句读：
//
//   "Skills can be large (verify=18.7KB, claude-api=20.1KB)"  ← 技能文件很大
//   "Previously re-injected unbounded on every compact"        ← 以前每次压缩都全量重注
//   "→ 5-10K tok/compact"                                       ← 每次白花 5-10K token
//
// 也就是说：一个会话压缩十次，就多花 5-10 万 token 在新会话根本用不上的
// 技能全文上。这些 token 还是 cache_creation（新内容，全价）。
//
// 解法是**先截断再筛选**，而不是直接丢掉整个技能：
//   "Per-skill truncation beats dropping — instructions at the top of a skill
//    file are usually the critical part."
//
// 这句话是整个文件的方法论缩影：**技能文件的价值分布是极度头重脚轻的**。
// 开头是"什么时候用我、怎么用我"，后面是长篇参考手册。
// 砍掉后半段损失很小，丢掉整个技能损失很大。
//
// 预算 25,000 = 5 个技能 × 单个上限 5,000。两个常量又一个乘除关系，
// 同样是"数量闸 + 总量闸"的双保险。
// Skills can be large (verify=18.7KB, claude-api=20.1KB). Previously re-injected
// unbounded on every compact → 5-10K tok/compact. Per-skill truncation beats
// dropping — instructions at the top of a skill file are usually the critical
// part. Budget sized to hold ~5 skills at the per-skill cap.
export const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000
export const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000
// 流式重试 2 次（也就是最多 3 次尝试）。
//
// 这个数字比 HTTP 层的重试小得多，原因很直接：
// **压缩本身就要 5-10 秒**，重试两次意味着用户可能干等 30 秒。
// 而 HTTP 层（withRetry）的重试是在几百毫秒内失败的请求上做的，成本低。
//
// 所以这里的 2 不是"容忍度"，是"用户的耐心上限"。
// 而且它默认是关的——下面 1251 行读 `tengu_compact_streaming_retry`，
// 默认值 `false`。
const MAX_COMPACT_STREAMING_RETRIES = 2

// 【为什么压缩前要剥掉图片】
//
// doc 注释给了两个理由，第二个才是真原因：
//
//   1. "Images are not needed for generating a conversation summary"
//      ——摘要不需要看到图。模型要写的是"用户发了一张 UI 截图抱怨按钮错位"，
//      不需要真的渲染那张图。
//
//   2. "can cause the compaction API call itself to hit the prompt-too-long limit,
//       especially in CCD sessions where users frequently attach images"
//      ——**这条才是关键**。压缩的输入就是那个已经超长的上下文。
//      一张 1,500 token 的图（1000×1000 大概这个量级）看起来不多，
//      但用户连发 20 张就是 3 万 token，而压缩本来是来救命的，
//      结果自己先被图撑爆 → 走 PTL 逃生舱 → 又得砍历史。
//
// 换句话说：**剥图是给逃生舱减负**，让压缩有更大几率一次成功。
//
// 【一个协议事实，注释里顺手写了】
// "Only user messages contain images"
// assistant 消息里只有 text / tool_use / thinking，永远不会有 image 块。
// 所以下面只需要处理 `message.type === 'user'`，不用两头都扫。
// 这个不对称性来自 API 的消息格式定义，不是这个文件的简化。
/**
 * Strip image blocks from user messages before sending for compaction.
 * Images are not needed for generating a conversation summary and can
 * cause the compaction API call itself to hit the prompt-too-long limit,
 * especially in CCD sessions where users frequently attach images.
 * Replaces image blocks with a text marker so the summary still notes
 * that an image was shared.
 *
 * Note: Only user messages contain images (either directly attached or within
 * tool_result content from tools). Assistant messages contain text, tool_use,
 * and thinking blocks but not images.
 */
export function stripImagesFromMessages(messages: Message[]): Message[] {
  return messages.map(message => {
    if (message.type !== 'user') {
      return message
    }

    const content = message.message.content
    if (!Array.isArray(content)) {
      return message
    }

    let hasMediaBlock = false
// 用 `flatMap` 而不是 `map` + 过滤，是因为一个 block 可能变成
// **零个或多个** block 之外，还要原样透传大多数 block。
//
// `flatMap` 的约定：返回数组就展开，返回 `[block]` 就是"原样保留一个"。
// 这样三种情况（替换成 1 个文本 / 替换后仍是 1 个 / 不动）统一成一个返回类型，
// 不用在外面再写一遍 filter。
//
// 【注意 160 行这个细节】
//   `return [{ type: 'text' as const, text: '[image]' }]`
//
// 不是直接删掉图块，而是换成一行文字标记。为什么？
// 因为摘要需要知道"这里曾经有过一张图"。如果静默删掉，
// 模型写出来的摘要会变成"用户描述了一个问题"，而实际上用户是发图说明的——
// 后续如果用户问"我刚发的那张图"，摘要里毫无线索，会话就断了。
//
// 保留一个 `[image]` 占位符只花 2 个 token，换回的是语义连续性。
    const newContent = content.flatMap(block => {
      if (block.type === 'image') {
        hasMediaBlock = true
        return [{ type: 'text' as const, text: '[image]' }]
      }
      if (block.type === 'document') {
        hasMediaBlock = true
        return [{ type: 'text' as const, text: '[document]' }]
      }
      // Also strip images/documents nested inside tool_result content arrays
// 图也可能藏在 tool_result 里面——比如用户让模型读一个 PDF 或截图，
// 工具返回的 content 数组里就有 image / document 块。
//
// 这层嵌套很容易漏：外层 block 是 `tool_result`（不是 image），
// 上面的 `if (block.type === 'image')` 抓不到，必须再往里钻一层。
//
// 【注意 182 行 `return [{ ...block, content: newToolContent }]`】
// 只有**真的剥掉了东西**（toolHasMedia）才构造新对象。
// 没剥的话走到 185 行的 `return [block]`，返回的是**原引用**。
//
// 这个"没改动就返回原对象"的模式在整份代码库里反复出现（188 行同理），
// 目的是保住引用相等性——下游可能有 Map 缓存、React memo、
// 或者像 claude.ts 里那种"引用被延迟队列持有"的地方。
// 一旦无条件浅拷贝，这些优化全部失效，而且极难排查。
      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        let toolHasMedia = false
        const newToolContent = block.content.map(item => {
          if (item.type === 'image') {
            toolHasMedia = true
            return { type: 'text' as const, text: '[image]' }
          }
          if (item.type === 'document') {
            toolHasMedia = true
            return { type: 'text' as const, text: '[document]' }
          }
          return item
        })
        if (toolHasMedia) {
          hasMediaBlock = true
          return [{ ...block, content: newToolContent }]
        }
      }
      return [block]
    })

    if (!hasMediaBlock) {
      return message
    }

    return {
      ...message,
      message: {
        ...message.message,
        content: newContent,
      },
    } as typeof message
  })
}

// 第二道减肥：剥掉"压缩后会被重新注入"的附件。
//
// 这个思路和上面剥图不同。剥图是"摘要不需要"，这里是"喂给摘要器是浪费"。
//
// 具体两类：
//   · skill_discovery —— 技能发现信号
//   · skill_listing   —— 技能清单（约 4K token）
//
// 注释说得很清楚：这两类在压缩后会被 `resetSentSkillNames()` +
// 下一轮的 discovery 信号重新推出来。也就是说**它们本来就是每轮重建的**，
// 摘要器读一遍不但没用，还会把过期的技能建议写进摘要里
// （"polute the summary with stale skill suggestions"）。
//
// 这是压缩设计里的一个通用原则：**凡是"可重建的派生信息"，都不要进摘要**。
// 摘要应该只装"无法从别处恢复的原始事实"。
/**
 * Strip attachment types that are re-injected post-compaction anyway.
 * skill_discovery/skill_listing are re-surfaced by resetSentSkillNames()
 * + the next turn's discovery signal, so feeding them to the summarizer
 * wastes tokens and pollutes the summary with stale skill suggestions.
 *
 * No-op when EXPERIMENTAL_SKILL_SEARCH is off (the attachment types
 * don't exist on external builds).
 */
export function stripReinjectedAttachments(messages: Message[]): Message[] {
// 又是 DCE：`feature('EXPERIMENTAL_SKILL_SEARCH')` 在外部构建里是 false，
// 整个 filter 分支被删掉，函数退化为 `return messages`（零成本直通）。
//
// 注释专门写了这一点："No-op when EXPERIMENTAL_SKILL_SEARCH is off
// (the attachment types don't exist on external builds)"。
//
// 【这是读这类代码时容易困惑的地方】
// 你可能会想："那两种 attachment 类型明明在 types 里定义了，怎么会不存在？"
// 答案是：类型定义在内部构建里也带 `feature()` 分支，或者干脆就是内部专有的
// 类型文件。外部构建的类型系统在编译期就把它们排除了——
// 所以这个 filter 里的 `m.attachment.type === 'skill_discovery'`
// 在外部构建的 TypeScript 检查里本身就会报"类型不可能相等"，
// 只能靠 feature 分支把它整段藏起来。
  if (feature('EXPERIMENTAL_SKILL_SEARCH')) {
    return messages.filter(
      m =>
        !(
          m.type === 'attachment' &&
          (m.attachment.type === 'skill_discovery' ||
            m.attachment.type === 'skill_listing')
        ),
    )
  }
  return messages
}

// 三个固定的错误文本常量。
//
// 它们的用途不只是"给人看"——`addErrorNotificationIfNeeded`（行 1108）
// 会用 `hasExactErrorMessage` 做**字符串精确比对**来决定要不要弹错误通知。
// 也就是说这些字符串是**控制流的一部分**，改一个字就会让"不该弹的通知弹出来"。
//
// 这是全代码库反复出现的一种模式：错误消息当错误码用。
// 它的代价是——任何一次文案润色都可能悄悄改掉行为。
export const ERROR_MESSAGE_NOT_ENOUGH_MESSAGES =
  'Not enough messages to compact.'
const MAX_PTL_RETRIES = 3
const PTL_RETRY_MARKER = '[earlier conversation truncated for compaction retry]'

// ═══ PTL 逃生舱（CC-1180）═══
//
// PTL = Prompt Too Long。场景是：上下文已经撑到上限了，
// 自动压缩赶来救场，结果**压缩请求本身也超了上限**。
// 这时用户彻底卡死——不能继续对话，也不能压缩，死循环。
//
// doc 注释里那句 "This is the last-resort escape hatch" 说得很准确。
// 它不优雅，但能让人从坑里爬出来。
//
// 【注意注释里承认的一件事】
// "The reactive-compact path (compactMessages.ts) has the proper retry loop
//  that peels from the tail; this helper is the dumb-but-safe fallback for
//  the proactive/manual path that wasn't migrated in bfdb472f's unification."
//
// 翻译：响应式压缩（413 之后那条路）有正经的尾巴剥离循环，
// 而这个函数是给"主动压缩 / 手动 /compact"用的笨办法——
// 因为当年 bfdb472f 那次统一重构**没把它迁过去**。
//
// 这是很有价值的线索：说明代码库里有两条压缩路径，一条先进一条落后，
// 而落后的那条还在生产上跑。读的时候不要把这里的实现当成"最佳实践"，
// 它自己都承认是遗留物。
/**
 * Drops the oldest API-round groups from messages until tokenGap is covered.
 * Falls back to dropping 20% of groups when the gap is unparseable (some
 * Vertex/Bedrock error formats). Returns null when nothing can be dropped
 * without leaving an empty summarize set.
 *
 * This is the last-resort escape hatch for CC-1180 — when the compact request
 * itself hits prompt-too-long, the user is otherwise stuck. Dropping the
 * oldest context is lossy but unblocks them. The reactive-compact path
 * (compactMessages.ts) has the proper retry loop that peels from the tail;
 * this helper is the dumb-but-safe fallback for the proactive/manual path
 * that wasn't migrated in bfdb472f's unification.
 */
export function truncateHeadForPTLRetry(
  messages: Message[],
  ptlResponse: AssistantMessage,
): Message[] | null {
// 【这是全文件最刁的一行，值得单独讲】
//
// 上一次重试如果加了 marker（284 行那段补的合成用户消息），
// 那么**这次**进来时，messages[0] 就是那个 marker 本身。
//
// 如果不先剥掉它，会发生什么：
//   · marker 自己成为 group 0（groupMessagesByApiRound 会把它当成独立一轮）
//   · 20% 回退分支算 `floor(groups.length * 0.2)`，组数少的时候 = 1
//   · 于是"删 1 组"删的就是 marker
//   · 264-289 行又把 marker 加回去
//   · **净效果为零，第二次重试和第一次完全一样**
//
// 注释原话："the 20% fallback stalls (drops only the marker, re-adds it,
// zero progress on retry 2+)"。
//
// 这是一个典型的"重试循环里混进了自己的副作用"bug。
// 修复方式不是改删的逻辑，而是**每次进来先把上次的副作用清掉**——
// 保证每一轮都在同一个干净基线上做决策。
//
// 【读这类代码的方法论】
// 看到 `for(;;)` 或 `for (let attempt...)` 里有"往输入里塞东西"的操作，
// 第一件事就是找"有没有在下一轮开头把它摘掉"。没有就是无限循环。
  // Strip our own synthetic marker from a previous retry before grouping.
  // Otherwise it becomes its own group 0 and the 20% fallback stalls
  // (drops only the marker, re-adds it, zero progress on retry 2+).
  const input =
    messages[0]?.type === 'user' &&
    messages[0].isMeta &&
    messages[0].message.content === PTL_RETRY_MARKER
      ? messages.slice(1)
      : messages

// 按"API 轮次"分组，而不是按消息条数。
//
// 一轮 = 一条 assistant（含 tool_use）+ 对应的 user（含 tool_result）。
// 必须按轮切，因为**切开工具调用和它的结果会让 API 直接报错**。
// 这个约束在 claude.ts 的 `normalizeMessagesForAPI` 里也处理过。
//
// `if (groups.length < 2) return null` —— 只剩一轮就没法再砍了，
// 砍完没东西可摘要。返回 null 让调用方走"放弃并报错"分支。
  const groups = groupMessagesByApiRound(input)
  if (groups.length < 2) return null

// 【两条完全不同的删法，取决于能不能从错误消息里抠出数字】
//
// `getPromptTooLongTokenGap(ptlResponse)` 会去解析 API 返回的错误文本，
// 比如 `"...exceed context limit: 188059 + 20000 > 200000"`，
// 算出"还差多少 token"（这里是 18059）。
//
// 拿到数字 → 262-269 行精确累加：从头开始一组一组加 token 数，
// 加到刚好覆盖这个缺口就停。**只删必要的量**，因为每删一条都是信息损失。
//
// 拿不到数字 → 270-272 行粗暴砍 20%。
// 为什么拿不到？注释说了：Vertex / Bedrock 的错误格式不一样。
// 这个解析依赖自然语言的精确格式，是全代码库最脆弱的地方之一
// （第 6 步 withRetry.ts 的 `parseMaxTokensContextOverflowError` 同一个毛病）。
  const tokenGap = getPromptTooLongTokenGap(ptlResponse)
  let dropCount: number
  if (tokenGap !== undefined) {
    let acc = 0
    dropCount = 0
    for (const g of groups) {
      acc += roughTokenCountEstimationForMessages(g)
      dropCount++
      if (acc >= tokenGap) break
    }
  } else {
    dropCount = Math.max(1, Math.floor(groups.length * 0.2))
  }

// 至少留一组，否则摘要器收到空输入。
//
// 这里的 `groups.length - 1` 和上面的 `dropCount` 取 min，
// 意味着最坏情况只删掉第一组——信息损失最小，但也可能根本不够。
// 不够的话下一轮循环还会再进来砍一次（`MAX_PTL_RETRIES = 3`）。
  // Keep at least one group so there's something to summarize.
  dropCount = Math.min(dropCount, groups.length - 1)
  if (dropCount < 1) return null

  const sliced = groups.slice(dropCount).flat()
// 【这一段解释了整份代码库里最隐蔽的一个约束】
//
// `groupMessagesByApiRound` 的分组规则是：
//   · 第 0 组 = 对话开头的 user 消息（preamble）
//   · 之后每一组开头都是 assistant
//
// 所以砍掉第 0 组之后，剩下的第一条消息是 **assistant**。
// 而 Anthropic API 硬性要求：**第一条消息必须是 role=user**。
// 直接发过去就是一个 400。
//
// 注释里那句 "ensureToolResultPairing already handles any orphaned
// tool_results this creates" 是在说：另一层已经有兜底，
// 但"首条必须是 user"这条没法靠它修，必须在这里补。
  // groupMessagesByApiRound puts the preamble in group 0 and starts every
  // subsequent group with an assistant message. Dropping group 0 leaves an
  // assistant-first sequence which the API rejects (first message must be
  // role=user). Prepend a synthetic user marker — ensureToolResultPairing
  // already handles any orphaned tool_results this creates.
// 补一条合成的 user 消息当门面，内容是 PTL_RETRY_MARKER。
//
// 注意它设了 `isMeta: true`——这个标记让 UI 不显示这条消息
// （用户不该看见"系统为了重试塞了一句占位"）。
//
// 【三行代码串起来看，就是一个完整的坑】
//   247 行：进来先把自己上次加的 marker 剥掉
//   284 行：需要时再加一个
//   228 行：marker 的文本是固定的常量
//
// 三者缺一不可。少了 247，重试会原地打转；少了 284，API 报 400；
// 少了 228 的常量复用，247 的字符串比对就匹配不上。
  if (sliced[0]?.type === 'assistant') {
    return [
      createUserMessage({ content: PTL_RETRY_MARKER, isMeta: true }),
      ...sliced,
    ]
  }
  return sliced
}

// 又是三个当错误码用的消息常量，这次是给 UI 看的。
//
// 注意 `ERROR_MESSAGE_PROMPT_TOO_LONG` 的措辞：
//   "Conversation too long. Press esc twice to go up a few messages and try again."
//
// 它建议的操作是「按两次 Esc 回退几条消息」——这说明在 PTL 逃生舱失败之后，
// 用户唯一能自救的办法就是**手动删掉最近几条消息**。
// 也就是说：这个常量代表的是"所有自动手段都用尽了"的终点。
//
// `ERROR_MESSAGE_INCOMPLETE_RESPONSE` 的措辞更委婉：
//   "Compaction interrupted · This may be due to network issues — please try again."
// 注意中点分隔符和破折号——这是 UI 排版考虑，不是随手打的。
export const ERROR_MESSAGE_PROMPT_TOO_LONG =
  'Conversation too long. Press esc twice to go up a few messages and try again.'
export const ERROR_MESSAGE_USER_ABORT = 'API Error: Request was aborted.'
export const ERROR_MESSAGE_INCOMPLETE_RESPONSE =
  'Compaction interrupted · This may be due to network issues — please try again.'

// ═══ 压缩的返回值 ═══
//
// 这个接口里有个**历史遗留的命名陷阱**，必须提前说清楚：
//
//   `postCompactTokenCount`      ← 名字像"压缩后的大小"，其实不是
//   `truePostCompactTokenCount`  ← 名字很怪，但**这个才是**压缩后的大小
//
// 真相在 626 行那段注释里：`postCompactTokenCount` 本来是照这个意思命名的，
// 后来发现它实际装的是**压缩那次 API 调用自己的 usage**
// （`input_tokens` ≈ 压缩前的输入量），跟"压缩后剩下多少"毫无关系。
// 但因为这个字段已经进了埋点系统（tengu_compact 事件），改名会断掉历史数据，
// 所以只能**加一个 trueXxx 字段，原来的名字留着**。
//
// 这是一个非常典型的"埋点字段不可改"成本。读的时候记住：
// 凡是看到 `postCompactTokenCount`，都当它是"压缩调用花了多少"，
// 不是"压缩后剩多少"。
export interface CompactionResult {
  boundaryMarker: SystemMessage
  summaryMessages: UserMessage[]
  attachments: AttachmentMessage[]
  hookResults: HookResultMessage[]
  messagesToKeep?: Message[]
  userDisplayMessage?: string
  preCompactTokenCount?: number
  postCompactTokenCount?: number
  truePostCompactTokenCount?: number
  compactionUsage?: ReturnType<typeof getTokenUsage>
}

// 这四个字段的存在理由，注释写得很直白：
// "Lets the tengu_compact event disambiguate same-chain loops (H2) from
//  cross-agent (H1/H5) and manual-vs-auto (H3) compactions without joins."
//
// 翻译：数据分析（BQ）那边要靠这些字段区分三种"压缩太频繁"的原因，
// 而又不想做多表 join。所以把诊断信息**直接塞进事件里**。
//
// 三种假设的编号（H1/H2/H3/H5）说明这是从一次真实的数据分析任务
// 倒推回来的设计——先有"为什么压缩老是触发"的疑问，
// 再问"需要哪些字段才能回答"，最后才加这些参数。
//
// 【这条注释的教学价值】
// 它展示了一种很实用的做法：**埋点字段的设计是从分析问题倒推的**，
// 不是为了"多记点东西说不定有用"。凡是看到这种带 H1/H2 编号的注释，
// 说明背后有一份数据分析文档，值得顺着找。
/**
 * Diagnosis context passed from autoCompactIfNeeded into compactConversation.
 * Lets the tengu_compact event disambiguate same-chain loops (H2) from
 * cross-agent (H1/H5) and manual-vs-auto (H3) compactions without joins.
 */
export type RecompactionInfo = {
  isRecompactionInChain: boolean
  turnsSincePreviousCompact: number
  previousCompactTurnId?: string
  autoCompactThreshold: number
  querySource?: QuerySource
}

// 这个函数的唯一价值是**顺序**。
//
// 注释里那行 "Order: boundaryMarker, summaryMessages, messagesToKeep,
// attachments, hookResults" 是契约，不是描述。
//
// 顺序为什么重要：
//   · boundaryMarker 必须是第一条——`getMessagesAfterCompactBoundary`
//     靠它做向后扫描，找"压缩后的起点"
//   · summaryMessages 紧跟其后——摘要必须紧贴边界，否则会被
//     "找最后一个 boundary" 的逻辑跳过
//   · messagesToKeep 在摘要**之后**——保留的消息代表"更近的历史"，
//     位置在摘要后面才符合时间序
//   · attachments 和 hookResults 最后——它们不是"对话内容"，
//     是"附加信息"，放后面不干扰边界扫描
//
// 全量压缩和局部压缩两个入口都调这个函数，就是为了保证两条路径
// 拼出来的数组**长得一模一样**。否则 `--resume` 还原时会出各种怪问题。
/**
 * Build the base post-compact messages array from a CompactionResult.
 * This ensures consistent ordering across all compaction paths.
 * Order: boundaryMarker, summaryMessages, messagesToKeep, attachments, hookResults
 */
export function buildPostCompactMessages(result: CompactionResult): Message[] {
  return [
    result.boundaryMarker,
    ...result.summaryMessages,
    ...(result.messagesToKeep ?? []),
    ...result.attachments,
    ...result.hookResults,
  ]
}

// 给边界标记挂上"保留段"的元数据。
//
// 场景：局部压缩之后，被保留的那段消息在磁盘上**没有移动**，
// 它们的 `parentUuid` 还指着压缩前的旧父节点。如果不管，
// `--resume` 加载时会走一条断掉的链——保留段变成孤儿。
//
// 解法是在 boundary 上记三个 uuid：
//   headUuid   = 保留段第一条
//   tailUuid   = 保留段最后一条
//   anchorUuid = **保留段前面应该接谁**（这个字段是重点）
//
// 加载器读到这个元数据后做两处修补：
//   head 的父指针 → anchorUuid
//   anchor 的其他子节点 → tailUuid
//
// 【`anchorUuid` 的语义随方向变化，这是最容易搞混的地方】
// 注释里列了：
//   · suffix-preserving（reactive / session-memory）：anchor = 最后一条摘要消息
//     ——因为摘要在前、保留段在后，所以保留段接在摘要后面
//   · prefix-preserving（partial compact 的 'from'）：anchor = boundary 自己
//     ——因为保留段在前、摘要在后，保留段接在边界后面
//
// 这个区别在 1078 行有个显式的三元表达式，是同一个概念的第二处体现。
/**
 * Annotate a compact boundary with relink metadata for messagesToKeep.
 * Preserved messages keep their original parentUuids on disk (dedup-skipped);
 * the loader uses this to patch head→anchor and anchor's-other-children→tail.
 *
 * `anchorUuid` = what sits immediately before keep[0] in the desired chain:
 *   - suffix-preserving (reactive/session-memory): last summary message
 *   - prefix-preserving (partial compact): the boundary itself
 */
export function annotateBoundaryWithPreservedSegment(
  boundary: SystemCompactBoundaryMessage,
  anchorUuid: UUID,
  messagesToKeep: readonly Message[] | undefined,
): SystemCompactBoundaryMessage {
// 没有保留段就原样返回 `boundary`（同一个对象，不是拷贝）。
// 又是"没改动就不造新对象"的模式。
  const keep = messagesToKeep ?? []
  if (keep.length === 0) return boundary
  return {
    ...boundary,
    compactMetadata: {
      ...boundary.compactMetadata,
      preservedSegment: {
        headUuid: keep[0]!.uuid,
        anchorUuid,
        tailUuid: keep.at(-1)!.uuid,
      },
    },
  }
}

// 把两处来的指令拼起来：用户自己写的（`/compact 关注 XXX`）+ hook 给的。
//
// 顺序有讲究：**用户在前，hook 在后**。因为 hook 通常是组织级策略
// （"摘要里必须包含 ticket 编号"），用户的是本次临时要求，
// 用户的话放前面权重更高——模型对靠前的内容更敏感。
//
// `|| undefined` 这个写法是为了把空字符串归一成 undefined。
// 因为 380 行要判 `if (!userInstructions)`，空字符串和 undefined
// 在 `!` 下等价，但返回值类型上要统一，否则调用方拿到的可能是 `''`，
// 再往下传会变成"有个空的 customInstructions"，让 prompt 里多出一段空段落。
/**
 * Merges user-supplied custom instructions with hook-provided instructions.
 * User instructions come first; hook instructions are appended.
 * Empty strings normalize to undefined.
 */
export function mergeHookInstructions(
  userInstructions: string | undefined,
  hookInstructions: string | undefined,
): string | undefined {
  if (!hookInstructions) return userInstructions || undefined
  if (!userInstructions) return hookInstructions
  return `${userInstructions}\n\n${hookInstructions}`
}

// ═══════════════════════════════════════════════════════════════
// 全量压缩的主函数（376 行，387-763）
//
// 输入：整个 messages 数组
// 输出：一个 CompactionResult（摘要 + 新边界 + 一堆附件）
//
// 【整体时序，先看骨架再看细节】
//
//    401  数一下压缩前多少 token（只为了埋点）
//    413  跑 PreCompact hook（用户可以在压缩前插手）
//    435  查"能不能复用主线程的 prompt cache"这个开关
//    450  ┌─ for(;;) PTL 重试循环
//    451  │    发请求拿摘要
//    460  │    摘要是 PTL 错误？→ 砍历史 → 回到循环头
//    493  └─ 循环出来后分类失败（无摘要 / API 错误）
//    518  快照文件读取状态，然后**清空**（关键顺序）
//    532  并行生成各种附件
//    592  跑 SessionStart hook（压缩等于一次"会话重启"）
//    598  造边界标记 + 摘要消息
//    650  打埋点
//    697  通知缓存检测器"这是压缩导致的缓存断层，别报警"
//    711  重新追加会话元数据（--resume 显示标题要用）
//    723  跑 PostCompact hook
//    738  返回
//
// 【两个 finally 里做的事很关键，别看漏】
// 757-762：不管成功失败，都要把 UI 状态复位（streamMode / responseLength /
// compactProgress / sdkStatus）。少复位一个，UI 就卡在"正在压缩"上不动了。
// ═══════════════════════════════════════════════════════════════
/**
 * Creates a compact version of a conversation by summarizing older messages
 * and preserving recent conversation history.
 */
export async function compactConversation(
  messages: Message[],
  context: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  suppressFollowUpQuestions: boolean,
  customInstructions?: string,
  isAutoCompact: boolean = false,
  recompactionInfo?: RecompactionInfo,
): Promise<CompactionResult> {
  try {
// 空数组直接抛。注意这个错误在 `addErrorNotificationIfNeeded` 里
// 是被**排除**的（1114 行）——因为它不是故障，是用户点了个空会话的 /compact。
    if (messages.length === 0) {
      throw new Error(ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)
    }

// `tokenCountWithEstimation` 而不是 `getTokenUsage`。
//
// 因为没有"上一次 API 响应"可查——这是压缩的**开始**，还没有任何响应。
// 所以只能本地估算（约 4 字符/token）。这个数字只用于埋点和显示，
// 不参与任何决策，所以估算足够。
    const preCompactTokenCount = tokenCountWithEstimation(messages)

    const appState = context.getAppState()
    void logPermissionContextForAnts(appState.toolPermissionContext, 'summary')

// 压缩进度有五个阶段事件，UI 靠它显示进度条：
//
//   hooks_start(pre_compact)    → 开始跑压缩前 hook
//   compact_start               → 开始调模型
//   hooks_start(session_start)  → 开始跑会话启动 hook
//   hooks_start(post_compact)   → 开始跑压缩后 hook
//   compact_end                 → 全部结束（在 finally 里）
//
// 注意 `hooks_start` 出现了三次，靠 `hookType` 区分。
// 这个设计的好处是 UI 只需要处理两种事件类型。
    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'pre_compact',
    })

// PreCompact hook。用户可以在这里：
//   · 检查即将被压缩的内容（做审计）
//   · 通过 `newCustomInstructions` **追加**摘要指令
//     （比如"务必把数据库 schema 变更写进摘要"）
//   · 通过 `userDisplayMessage` 在界面上显示一段提示
//
// 注意 415 行传的 `trigger: isAutoCompact ? 'auto' : 'manual'`——
// hook 脚本可以据此决定要不要插手。自动压缩是高频操作，
// hook 里做重活会拖慢整个循环。
//
// 传 `abortController.signal` 意味着用户按 Esc 能中断 hook 本身。
    // Execute PreCompact hooks
    context.setSDKStatus?.('compacting')
    const hookResult = await executePreCompactHooks(
      {
        trigger: isAutoCompact ? 'auto' : 'manual',
        customInstructions: customInstructions ?? null,
      },
      context.abortController.signal,
    )
// hook 给的指令和用户给的指令合并，然后**覆盖** `customInstructions`。
//
// 注意这里是重新赋值（`customInstructions = ...`），
// 而不是新开一个变量。所以后面 440 行的 `getCompactPrompt(customInstructions)`
// 拿到的已经是合并后的版本。
//
// 这种"就地覆盖参数"的写法在长函数里不太好读，但这里只有一个消费点，还能接受。
    customInstructions = mergeHookInstructions(
      customInstructions,
      hookResult.newCustomInstructions,
    )
    const userDisplayMessage = hookResult.userDisplayMessage

    // Show requesting mode with up arrow and custom message
    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_start' })

// ═══ 这五行注释是整份代码库里最有说服力的一段数据 ═══
//
// 读三遍：
//   "Experiment (Jan 2026) confirmed: false path is 98% cache miss,
//    costs ~0.76% of fleet cache_creation (~38B tok/day)"
//
// 翻译：2026 年 1 月做过实验，如果**不**复用主线程的 prompt cache
// （也就是 `false` 那条路），压缩请求的缓存命中率是 **2%**，
// 白白烧掉整个机队 0.76% 的 cache_creation，约 **380 亿 token/天**。
//
// 为什么会这么惨？因为压缩请求和主对话共享：
//   · 同一个 system prompt（约 10K token）
//   · 同一整套工具定义（约 15-20K token）
//   · 同一个消息前缀（整个历史）
//
// 如果不复用，这三块全部要按 cache_creation 全价计费。
// 而缓存命中的前提是**前缀字节完全一致**——这就是为什么
// 1181 行那段注释死活不让设 `maxOutputTokens`（后面细讲）。
//
// 注释最后一句也重要："GB gate kept as kill-switch"
// 虽然默认 true，但留了一个 GrowthBook 开关，出问题能一键关掉。
// 这是所有高风险优化的标准配置：**默认开、留开关、埋对比数据**。
    // 3P default: true — forked-agent path reuses main conversation's prompt cache.
    // Experiment (Jan 2026) confirmed: false path is 98% cache miss, costs ~0.76% of
    // fleet cache_creation (~38B tok/day), concentrated in ephemeral envs (CCR/GHA/SDK)
    // with cold GB cache and 3P providers where GB is disabled. GB gate kept as kill-switch.
    const promptCacheSharingEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_compact_cache_prefix',
      true,
    )

// 摘要请求的 prompt。注意它是作为一条 **user 消息** 发出去的
// （441-443 行 `createUserMessage`），不是 system prompt。
//
// 为什么？因为如果塞进 system prompt，整个 system 就变了，
// 上面那个"复用主线程缓存"就废了。作为 user 消息追加在历史末尾，
// 前面的前缀完全不变，缓存才能命中。
//
// 【这是一个贯穿整个压缩设计的原则】
// **要发新指令，就追加在末尾，不要改动前面。**
// claude.ts 里那些 delta attachment（`deferred_tools_delta` 等）
// 是同一个原则的另一处应用。
    const compactPrompt = getCompactPrompt(customInstructions)
    const summaryRequest = createUserMessage({
      content: compactPrompt,
    })

    let messagesToSummarize = messages
    let retryCacheSafeParams = cacheSafeParams
    let summaryResponse: AssistantMessage
    let summary: string | null
    let ptlAttempts = 0
// ═══ PTL 重试循环（CC-1180 的具体落地）═══
//
// `for(;;)` 没有条件——退出全靠里面的 `break`（460 行，正常拿到摘要）
// 和 `throw`（477 行，放弃）。
//
// 这个循环最多转 4 次：原始 1 次 + `MAX_PTL_RETRIES`(3) 次截断重试。
// 超过就是 `truncated = null` → 抛 `ERROR_MESSAGE_PROMPT_TOO_LONG`
// → 用户看到"按两次 Esc 回退几条消息"。
//
// 【注意 446 行 `retryCacheSafeParams`】
// 它和 `messagesToSummarize` 是**两个必须同步更新的变量**。
// 原因在 485 行那段注释：forked-agent 路径读的是
// `cacheSafeParams.forkContextMessages`，**不是** 函数参数 `messages`。
// 只更新一个，另一条路径就会拿着旧的（没截断的）消息去请求，
// 于是再次 PTL，循环白转。
    for (;;) {
      summaryResponse = await streamCompactSummary({
        messages: messagesToSummarize,
        summaryRequest,
        appState,
        context,
        preCompactTokenCount,
        cacheSafeParams: retryCacheSafeParams,
      })
      summary = getAssistantMessageText(summaryResponse)
// 【为什么这里用 `startsWith(...)` 判断错误，而不是 try/catch】
//
// 因为 PTL 错误根本没被抛出来。`query()` 会把 API 错误**包装成
// 一条合成的 assistant 消息**（带 `isApiErrorMessage: true`）yield 出来，
// 而 `streamCompactSummary` 只取最后那条 assistant 消息的文本。
//
// 所以"摘要"这个变量里可能装的其实是错误消息——
// 这也解释了 1205 行那个 `isApiErrorMessage` 守卫为什么必须存在。
//
// 用一个字符串前缀来判断"这次调用失败了"，是很脆的做法，
// 但在这个架构下没有更干净的办法：错误已经变成"正常返回值"了。
// 注释里的 `PROMPT_TOO_LONG_ERROR_MESSAGE` 和上面 293 行的
// `ERROR_MESSAGE_PROMPT_TOO_LONG` 是**两个不同的常量**，
// 一个是 API 原始错误前缀，一个是给用户看的文案，别搞混。
      if (!summary?.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)) break

      // CC-1180: compact request itself hit prompt-too-long. Truncate the
      // oldest API-round groups and retry rather than leaving the user stuck.
      ptlAttempts++
// 三元表达式把"还能不能重试"和"怎么砍"压在一起：
//   `ptlAttempts <= MAX_PTL_RETRIES` → 调 truncateHeadForPTLRetry
//   否则 → null（后面 469 行直接判 null 并放弃）
//
// 注意 `ptlAttempts++` 在这之前——所以第 1 次截断时 `ptlAttempts` 已经是 1，
// 第 3 次是 3，第 4 次是 4 > 3 → null。总共 3 次截断机会，符合常量命名。
      const truncated =
        ptlAttempts <= MAX_PTL_RETRIES
          ? truncateHeadForPTLRetry(messagesToSummarize, summaryResponse)
          : null
      if (!truncated) {
        logEvent('tengu_compact_failed', {
          reason:
            'prompt_too_long' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          preCompactTokenCount,
          promptCacheSharingEnabled,
          ptlAttempts,
        })
        throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG)
      }
      logEvent('tengu_compact_ptl_retry', {
        attempt: ptlAttempts,
        droppedMessages: messagesToSummarize.length - truncated.length,
        remainingMessages: truncated.length,
      })
      messagesToSummarize = truncated
      // The forked-agent path reads from cacheSafeParams.forkContextMessages,
      // not the messages param — thread the truncated set through both paths.
// 【整个循环里最容易漏的一行】
//
// `retryCacheSafeParams = { ...retryCacheSafeParams, forkContextMessages: truncated }`
//
// 为什么要同时改两个东西：
//   · `messagesToSummarize` → 给"普通流式"路径用（1136 行函数的 messages 参数）
//   · `forkContextMessages` → 给"复用缓存"路径用（runForkedAgent 从 cacheSafeParams 读）
//
// 只改前者 → 缓存路径还在发完整历史 → 还是 PTL → 循环空转。
// 只改后者 → 反过来。
//
// 【这条注释的教学价值】
// 它记录了一次真实的修复："thread the truncated set through both paths"。
// 当你看到一个函数有两个数据来源（参数 + 配置对象）时，
// 任何"改写输入"的操作都要**同时改所有来源**。这是长函数最容易出的 bug 类型。
      retryCacheSafeParams = {
        ...retryCacheSafeParams,
        forkContextMessages: truncated,
      }
    }

// ═══ 三种失败分类，对应三个埋点 reason ═══
//
//   `!summary`                 → 'no_summary'    模型返回了但没文本
//   `startsWithApiErrorPrefix` → 'api_error'     API 层错误被包装成消息
//   （上面 477 行）             → 'prompt_too_long'  截断也用尽了
//
// `no_summary` 的情况比想象中常见：模型可能只返回了 thinking 块
// （但这里 thinking 是 disabled 的），或者被 stop sequence 截断，
// 或者返回了纯 tool_use（但 `createCompactCanUseTool` 全 deny）。
//
// `api_error` 用的是 `startsWithApiErrorPrefix` 而不是精确比对，
// 因为 API 错误文本有无数种。而 `ERROR_MESSAGE_USER_ABORT` 那种
// 需要精确比对的，是因为那个字符串是我们自己生成的。
//
// 注意 495 行把整个响应 JSON 化后打进调试日志——这可能是几 KB 的内容，
// 只在 `level: 'error'` 时落盘，所以生产环境平时看不见。
    if (!summary) {
      logForDebugging(
        `Compact failed: no summary text in response. Response: ${jsonStringify(summaryResponse)}`,
        { level: 'error' },
      )
      logEvent('tengu_compact_failed', {
        reason:
          'no_summary' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        preCompactTokenCount,
        promptCacheSharingEnabled,
      })
      throw new Error(
        `Failed to generate conversation summary - response did not contain valid text content`,
      )
// ⚠️ 注意这里有个细节：`api_error` 分支直接把 `summary`（错误文本）
// 当成 `throw new Error(summary)` 抛出去。
//
// 也就是说用户看到的错误消息就是 API 的原始文本。
// 这是有意的——API 错误往往包含可操作信息（比如配额、模型名、区域），
// 包一层"压缩失败"反而丢失信息。
    } else if (startsWithApiErrorPrefix(summary)) {
      logEvent('tengu_compact_failed', {
        reason:
          'api_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        preCompactTokenCount,
        promptCacheSharingEnabled,
      })
      throw new Error(summary)
    }

// 【顺序：先快照，再清空。这两行不能换】
//
// `preCompactReadFileState` 是给 `createPostCompactFileAttachments` 用的，
// 它要按"最近读过"的顺序挑文件重新注入。
//
// 如果先 clear 再快照，拿到的是空对象 → 压缩后一个文件都不恢复
// → 模型得把之前读过的文件全部重新 Read 一遍。
// 在长会话里这可能是几十次工具调用，用户会明显感觉到"变笨了"。
    // Store the current file state before clearing
    const preCompactReadFileState = cacheToObject(context.readFileState)

// 清空文件读取状态缓存。
//
// 为什么必须清？因为这个缓存的作用是"文件没变就别重复读"——
// 它会记住每个文件的 mtime 和内容摘要，下次 Read 时如果没变，
// 就返回一个 `FILE_UNCHANGED_STUB` 而不是全文。
//
// 但压缩之后，**模型已经看不到那些文件内容了**（被摘要替换掉了）。
// 如果缓存还在，模型 Read 同一个文件时会拿到 "file unchanged" 的桩，
// 而它其实根本不知道内容是什么——彻底卡死。
//
// 所以这里清空是**为了配合压缩造成的信息丢失**，不是常规清理。
// 同理 522 行的 `loadedNestedMemoryPaths`（已加载的嵌套 CLAUDE.md 路径）。
//
// 【对照 1610 行的 collectReadToolFilePaths】
// 那个函数专门跳过 `FILE_UNCHANGED_STUB` 的 Read 记录，
// 正是因为"桩指向的完整内容可能已经被压缩掉了"。这是同一个坑的两处防御。
    // Clear the cache
    context.readFileState.clear()
    context.loadedNestedMemoryPaths?.clear()

// ═══ 一整段"我故意没做某件事"的注释 ═══
//
// 这段比它上面写的代码更重要，因为它解释了一个**看起来像遗漏的决定**：
//
// 压缩之后没有调用 `resetSentSkillNames()`，也就意味着**不会重新注入
// 完整的 skill_listing**（约 4K token）。
//
// 三个理由：
//   1. 纯粹是 cache_creation，收益边缘
//      ——重新注入 = 全新内容 = 全价计费
//   2. 模型还有 SkillTool 在 schema 里，需要时能自己去发现
//   3. `invoked_skills` 附件（1494 行）会保住**已经用过的**技能内容
//
// 最后一句 "Ants with EXPERIMENTAL_SKILL_SEARCH already skip re-injection
// via the early-return in getSkillListingAttachments" 是在说：
// 内部用户（ant）本来就不重注，所以这个决定让内外部行为一致了。
//
// 【为什么这种注释值得单独批注】
// 代码里"没写的那行"是最难 review 的。半年后有人看到这里，
// 第一反应一定是"是不是漏了 resetSentSkillNames？"然后顺手加上，
// 于是每次压缩多烧 4K token。这种注释就是防这个的。
//
// 你自己写代码时也可以学：**凡是"刻意不做"的地方，留一句 why。**
    // Intentionally NOT resetting sentSkillNames: re-injecting the full
    // skill_listing (~4K tokens) post-compact is pure cache_creation with
    // marginal benefit. The model still has SkillTool in its schema and
    // invoked_skills attachment (below) preserves used-skill content. Ants
    // with EXPERIMENTAL_SKILL_SEARCH already skip re-injection via the
    // early-return in getSkillListingAttachments.

// 并行生成两批附件。用 `Promise.all` 而不是顺序 await，
// 因为文件重读（要查磁盘 + 校验 + 截断）和 agent 状态扫描互不依赖。
//
// 注意 `createPostCompactFileAttachments` 内部还会再并发读 5 个文件，
// 所以这里实际是"嵌套并发"。所有 I/O 加起来通常几十毫秒，
// 但放到长会话（20 个文件候选）上就能感觉到差别。
    // Run async attachment generation in parallel
    const [fileAttachments, asyncAgentAttachments] = await Promise.all([
      createPostCompactFileAttachments(
        preCompactReadFileState,
        context,
        POST_COMPACT_MAX_FILES_TO_RESTORE,
      ),
      createAsyncAgentAttachmentsIfNeeded(context),
    ])

// 从这里开始往下一路 push，一共七类附件。列一下全景，
// 读的时候可以对照：
//
//   542  fileAttachments        最近读过的文件（最多 5 个）
//   543  asyncAgentAttachments  后台跑着的 / 未取结果的 agent
//   545  planAttachment         当前 plan 文件内容
//   552  planModeAttachment     plan mode 的状态与指令
//   558  skillAttachment        会话中调用过的技能
//   567  deferredToolsDelta     延迟加载的工具清单
//   575  agentListingDelta      可用 agent 列表
//   578  mcpInstructionsDelta   MCP 服务器指令
//
// 再加上 592 行的 `hookMessages`（SessionStart hook 的输出）。
//
// 【这七项各自的"不补会怎样"】
//   文件      → 模型重新 Read，浪费几十次工具调用
//   agent     → 重复 spawn 同一个任务，或者忘记去取已完成的结果
//   plan      → 不知道自己在执行什么计划
//   plan mode → 直接开始改代码（本该只出方案）
//   技能      → 违反技能里的规范，输出格式全错
//   工具清单  → 以为某个 MCP 工具不存在，改用手写脚本
//   agent 列表→ 不知道可以委派，全部自己干
//   MCP 指令  → 不知道某个服务器要求用特定格式调用
//
// 这些不是"锦上添花"，每一条都对应一种真实的能力退化。
    const postCompactFileAttachments: AttachmentMessage[] = [
      ...fileAttachments,
      ...asyncAgentAttachments,
    ]
    const planAttachment = createPlanAttachmentIfNeeded(context.agentId)
    if (planAttachment) {
      postCompactFileAttachments.push(planAttachment)
    }

    // Add plan mode instructions if currently in plan mode, so the model
    // continues operating in plan mode after compaction
// plan mode 的附件要 `await`，因为 `createPlanModeAttachmentIfNeeded`
// 内部要读 appState（判断当前是不是 plan 模式）和 plan 文件是否存在。
//
// 注意这个函数声明成 async 但其实没有任何真正的异步操作——
// 纯粹是为了和 `createAsyncAgentAttachmentsIfNeeded` 保持签名一致。
// 这种"为了对称而 async"的写法在这里无伤大雅，但会让人误以为它很慢。
    const planModeAttachment = await createPlanModeAttachmentIfNeeded(context)
    if (planModeAttachment) {
      postCompactFileAttachments.push(planModeAttachment)
    }

    // Add skill attachment if skills were invoked in this session
    const skillAttachment = createSkillAttachmentIfNeeded(context.agentId)
    if (skillAttachment) {
      postCompactFileAttachments.push(skillAttachment)
    }

// ═══ 重新宣告 delta 附件 ═══
//
// 这段的注释很短但信息量很大："Compaction ate prior delta attachments."
//
// 背景：为了不破坏 prompt cache，工具清单、agent 列表、MCP 指令这些
// **不是每轮全量塞进去，而是只在变化时推一个 diff**
// （`deferred_tools_delta` 等，见 claude.ts 的 delta attachment 机制）。
//
// 但压缩把历史全吃了，那些 delta 也一起没了。模型现在完全不知道
// 有哪些延迟加载的工具、有哪些 MCP 服务器。
//
// 解法是：**假装历史是空的，重新宣告一遍**。所以三个调用
// 传的都是空数组 `[]`——"跟空历史做 diff"，结果就是全量。
//
// 注释里那句 "Empty message history → diff against nothing →
// announces the full set" 就是在解释这个技巧。
//
// 【这是一个很聪明但也很难懂的设计】
// 它把"全量推送"表达成"跟空集合的差集"，从而**复用同一个函数**，
// 不用写两套代码。代价是读代码的人必须理解 diff 语义才能看懂
// 为什么传空数组。局部压缩那边（957 行）传的是 `messagesToKeep`，
// 因为保留段里已经宣告过的部分要跳过——这正好说明了这套语义的价值。
    // Compaction ate prior delta attachments. Re-announce from the current
    // state so the model has tool/instruction context on the first
    // post-compact turn. Empty message history → diff against nothing →
    // announces the full set.
    for (const att of getDeferredToolsDeltaAttachment(
      context.options.tools,
      context.options.mainLoopModel,
      [],
      { callSite: 'compact_full' },
    )) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }
    for (const att of getAgentListingDeltaAttachment(context, [])) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }
    for (const att of getMcpInstructionsDeltaAttachment(
      context.options.mcpClients,
      context.options.tools,
      context.options.mainLoopModel,
      [],
    )) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }

// 压缩完成后跑 SessionStart hook。
//
// 为什么压缩要触发"会话启动"？因为从模型的角度看，**这就是一次新会话**：
// 上下文被重置成"摘要 + 附件"，跟 `--resume` 加载一堆历史的效果类似。
//
// 所以任何"会话开始时要做的事"（加载环境信息、检查 git 状态、
// 注入项目约定）在这里也要做一遍。漏了的话，压缩后模型会突然
// "忘记"项目约定，行为明显退化。
    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'session_start',
    })
    // Execute SessionStart hooks after successful compaction
    const hookMessages = await processSessionStartHooks('compact', {
      model: context.options.mainLoopModel,
    })

// 【先造边界标记和摘要消息，再打埋点——顺序有原因】
//
// 注释："Create the compact boundary marker and summary messages before the
// event so we can compute the true resulting-context size."
//
// 因为埋点里要记 `truePostCompactTokenCount`（压缩后上下文真实大小），
// 而这个数必须把 boundary + summary + attachments + hookMessages
// 全算进去（637 行那段）。所以这几样必须先造出来。
//
// 如果先打埋点再造这些，就只能记"摘要本身多大"，漏掉附件——
// 而附件往往比摘要还大（前面算过，最多 25K 文件 + 25K 技能）。
// 那个数就会严重偏低，导致 `willRetriggerNextTurn` 判断错误。
    // Create the compact boundary marker and summary messages before the
    // event so we can compute the true resulting-context size.
    const boundaryMarker = createCompactBoundaryMessage(
      isAutoCompact ? 'auto' : 'manual',
      preCompactTokenCount ?? 0,
      messages.at(-1)?.uuid,
    )
// ═══ 这一小段是压缩正确性的关键，但极易被忽略 ═══
//
// 问题：延迟加载的 MCP 工具，模型必须"用过一次"才会把 schema 真正加载进来。
// 这个"已加载"的状态是记在消息历史里的 `tool_reference` 块上的。
//
// 而摘要**不会保留 tool_reference 块**——摘要是自然语言，写不出结构化引用。
//
// 后果：压缩之后，这些工具的 schema 从请求里消失了。模型会看到
// 一个自己"曾经用过"的工具突然变成"未加载"状态，于是重新加载一次
// （或者干脆认为它不存在）。
//
// 解法：把已加载的工具名记在 boundary 的 `compactMetadata` 里。
// 之后 claude.ts 的 schema 过滤器会读这个字段，继续把那些 schema 发给 API。
//
// 【这行代码为什么值得单独批注】
// 它体现了一个通用模式：**任何"藏在消息内容里的状态"，压缩前都要
// 显式搬到 boundary 上**。因为 boundary 是唯一保证活过压缩的东西。
// 后面 1023 行的 `extractDiscoveredToolNames(allMessages)` 是同一件事
// 在局部压缩里的版本（用 allMessages 而不是 messagesToSummarize，
// 因为并集是幂等的，比判断"这条工具落在哪半边"简单）。
    // Carry loaded-tool state — the summary doesn't preserve tool_reference
    // blocks, so the post-compact schema filter needs this to keep sending
    // already-loaded deferred tool schemas to the API.
    const preCompactDiscovered = extractDiscoveredToolNames(messages)
    if (preCompactDiscovered.size > 0) {
      boundaryMarker.compactMetadata.preCompactDiscoveredTools = [
        ...preCompactDiscovered,
      ].sort()
    }

// 拿 transcript 路径，写进摘要消息里（616 行的 `getCompactUserSummaryMessage`
// 会把它塞进文案）。
//
// 目的是告诉模型："完整历史在这个文件里，需要细节可以自己去读"。
// 这样即使摘要漏了某个细节，模型还有补救的途径——而不是彻底失忆。
//
// 这是"摘要 + 指针"的经典设计：摘要负责省 token，
// 指针负责在需要时能找回原物。
    const transcriptPath = getTranscriptPath()
    const summaryMessages: UserMessage[] = [
      createUserMessage({
        content: getCompactUserSummaryMessage(
          summary,
          suppressFollowUpQuestions,
          transcriptPath,
        ),
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
      }),
    ]

// ═══ 这段注释记录了一次命名事故，值得完整读 ═══
//
//   "Previously 'postCompactTokenCount' — renamed because this is the
//    compact API call's total usage (input_tokens ≈ preCompactTokenCount),
//    NOT the size of the resulting context. Kept for event-field continuity."
//
// 翻译：这个值以前叫 `postCompactTokenCount`，但它的实际含义是
// **"压缩那次 API 调用花了多少 token"**（`input_tokens` 约等于压缩前的输入量），
// 跟"压缩后上下文剩多少"完全不是一回事。
//
// 想想有多离谱：一个叫"压缩后 token 数"的字段，实际存的是
// "压缩前有多少 token"。任何人看埋点都会得出相反的结论——
// 压缩后 180K？那压缩根本没起作用啊。
//
// 修复方式是改局部变量名（`compactionCallTotalTokens`），
// 但 **event 字段名保持 `postCompactTokenCount` 不变**，
// 注释原话 "Kept for event-field continuity"——为了历史数据能连上。
//
// 【这是一个无法两全的权衡】
// 改名 → 埋点数据断层，之前的图表全部失效
// 不改 → 每个新人都要踩一次这个坑
// 他们的选择是"改代码里的名字 + 注释说明"，代价是读埋点定义的人
// 仍然会误解，除非他点进代码看。
//
// 读源码时遇到这种"名字和含义不符"的地方，通常都能在附近找到
// 类似的历史说明。**这是最有价值的注释类型之一**，因为它记录的
// 是"为什么不能改成正确的东西"。
    // Previously "postCompactTokenCount" — renamed because this is the
    // compact API call's total usage (input_tokens ≈ preCompactTokenCount),
    // NOT the size of the resulting context. Kept for event-field continuity.
    const compactionCallTotalTokens = tokenCountFromLastAPIResponse([
      summaryResponse,
    ])

// ═══ 这才是"压缩后剩多少" ═══
//
// 注意注释里那个 20-40K 的提醒：
//   "The next iteration's shouldAutoCompact will see this PLUS ~20-40K for
//    system prompt + tools + userContext (via API usage.input_tokens)."
//
// 意思是：这里算出来的只是**消息部分的估算**。下一轮真正的
// 上下文大小 = 这个数 + system prompt（约 10K）+ 工具定义（约 15-20K）
// + userContext（环境信息等）。
//
// 所以 `willRetriggerNextTurn` 的判断（656 行）是：
//   这个估算值 >= 自动压缩阈值？
//
// 注释说得很谨慎："`true` 是个强信号；`false` 仍可能触发"。
// 因为如果估算值离阈值只差一点点，加上那 20-40K 就超了。
//
// 【这是一个诚实的注释】
// 它没有假装这个判断很准，而是明确说了两个方向的可靠性不对称。
// 这种诚实比一个"看起来精确"的公式有用得多。
    // Message-payload estimate of the resulting context. The next iteration's
    // shouldAutoCompact will see this PLUS ~20-40K for system prompt + tools +
    // userContext (via API usage.input_tokens). So `willRetriggerNextTurn: true`
    // is a strong signal; `false` may still retrigger when this is close to threshold.
    const truePostCompactTokenCount = roughTokenCountEstimationForMessages([
      boundaryMarker,
      ...summaryMessages,
      ...postCompactFileAttachments,
      ...hookMessages,
    ])

    // Extract compaction API usage metrics
    const compactionUsage = getTokenUsage(summaryResponse)

    const querySourceForEvent =
      recompactionInfo?.querySource ?? context.options.querySource ?? 'unknown'

// `tengu_compact` 是这个文件最重要的埋点。字段大约 30 个，分四组：
//
//   ① 规模       preCompactTokenCount / truePostCompactTokenCount
//   ② 触发原因   isAutoCompact / autoCompactThreshold / willRetriggerNextTurn
//   ③ 调用链     querySource / queryChainId / queryDepth /
//                isRecompactionInChain / turnsSincePreviousCompact
//   ④ 成本       compactionInputTokens / OutputTokens /
//                CacheReadTokens / CacheCreationTokens / TotalTokens
//
// 【第 ③ 组最值得注意】
// `isRecompactionInChain` + `turnsSincePreviousCompact` + `previousCompactTurnId`
// 三个字段合起来能回答一个很关键的问题：
// **"这个用户是不是在压缩→几轮→又压缩的循环里打转？"**
//
// 如果是，说明压缩没起作用——可能是摘要太长、或者附件太重、
// 或者用户的工作模式本身就需要超长上下文。这是产品决策的输入，
// 不是工程 bug。
//
// 【第 ④ 组的一个细节】
// `compactionTotalTokens` 是四个数相加：普通输入 + 缓存创建 + 缓存读 + 输出。
// 注意这里的"输入"和"缓存读"是分开算的，因为单价不同（缓存读便宜一个数量级）。
// 把三者加成"总额"只用于粗看，真实成本要用分项算。
    logEvent('tengu_compact', {
      preCompactTokenCount,
      // Kept for continuity — semantically the compact API call's total usage
      postCompactTokenCount: compactionCallTotalTokens,
      truePostCompactTokenCount,
      autoCompactThreshold: recompactionInfo?.autoCompactThreshold ?? -1,
      willRetriggerNextTurn:
        recompactionInfo !== undefined &&
        truePostCompactTokenCount >= recompactionInfo.autoCompactThreshold,
      isAutoCompact,
      querySource:
        querySourceForEvent as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryChainId: (context.queryTracking?.chainId ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: context.queryTracking?.depth ?? -1,
      isRecompactionInChain: recompactionInfo?.isRecompactionInChain ?? false,
      turnsSincePreviousCompact:
        recompactionInfo?.turnsSincePreviousCompact ?? -1,
      previousCompactTurnId: (recompactionInfo?.previousCompactTurnId ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      compactionInputTokens: compactionUsage?.input_tokens,
      compactionOutputTokens: compactionUsage?.output_tokens,
      compactionCacheReadTokens: compactionUsage?.cache_read_input_tokens ?? 0,
      compactionCacheCreationTokens:
        compactionUsage?.cache_creation_input_tokens ?? 0,
      compactionTotalTokens: compactionUsage
        ? compactionUsage.input_tokens +
          (compactionUsage.cache_creation_input_tokens ?? 0) +
          (compactionUsage.cache_read_input_tokens ?? 0) +
          compactionUsage.output_tokens
        : 0,
      promptCacheSharingEnabled,
// ═══ 一个 11 毫秒的同步遍历，为什么要用 IIFE 包起来 ═══
//
// 注释说得很清楚：
//   "analyzeContext walks every content block (~11ms on a 4.5K-message session)
//    purely for this telemetry breakdown. Computed here, past the compaction-API
//    await, so the sync walk doesn't starve the render loop before compaction
//    even starts."
//
// 翻译：`analyzeContext` 要遍历每一条消息的每一个 content block，
// 4,500 条消息的会话上要 **11 毫秒**。这纯粹是为了埋点里的分类统计
// （多少 token 是用户文本、多少是工具结果、多少是图片…）。
//
// 关键在"computed here, past the compaction-API await"：
// 如果放在函数开头算，那是在**压缩开始前**，UI 正在显示"正在压缩"，
// 主线程被占 11ms 会明显卡一下（Ink 的渲染是同步的）。
// 放在这里算，压缩的 API 调用已经结束了，接下来本来就是等待，
// 这 11ms 就不影响观感。
//
// 【IIFE + try/catch 的写法意图】
// IIFE（立即执行函数）是为了在对象字面量里塞一段语句块——
// `...(() => {...})()` 展开成一个对象。这是唯一能在对象里
// 做"局部变量 + 条件返回"的写法。
//
// try/catch 是因为埋点**绝对不能影响主流程**。
// 如果 `analyzeContext` 在某个畸形消息上崩了，不能让压缩失败。
// 这种"埋点用 try 包住"的做法在全代码库随处可见——
// 只要看到 `catch (error) { logError(error); return {} }` 就知道是这个意图。
//
// 【顺带说一个性能细节】
// `analyzeContext(messages)` 用的是**压缩前**的 messages，
// 不是压缩后的。因为这个埋点要回答"这次压缩吃掉了什么"，
// 所以要看被吃掉的那部分构成。
      // analyzeContext walks every content block (~11ms on a 4.5K-message
      // session) purely for this telemetry breakdown. Computed here, past
      // the compaction-API await, so the sync walk doesn't starve the
      // render loop before compaction even starts. Same deferral pattern
      // as reactiveCompact.ts.
      ...(() => {
        try {
          return tokenStatsToStatsigMetrics(analyzeContext(messages))
        } catch (error) {
          logError(error as Error)
          return {}
        }
      })(),
    })

// ═══ 通知缓存检测器 ═══
//
// `notifyCompaction` 做的事：告诉"prompt cache 断裂检测"系统
// "接下来会看到一次巨大的缓存断层，那是压缩导致的，不是我干的"。
//
// 为什么要专门通知？因为那个检测系统（promptCacheBreakDetection.ts）
// 的逻辑是：如果连续两次请求的前缀差异很大，就报一次
// `tengu_prompt_cache_break` 事件，用来发现"某处代码不小心改动了前缀"。
//
// 但压缩**故意**要换掉整个前缀（历史全变成摘要了）。不通知的话，
// 每次压缩都会误报一次缓存断裂——真实故障就被淹没了。
//
// 【上一轮读 autoCompact 时发现的相关 bug】
// session memory 那条压缩路径忘了调 `notifyCompaction`，
// 导致约 20% 的缓存断裂告警是误报（BQ 2026-03-01 定位）。
// 两条实现路径漏同步副作用，是这类"跨模块通知"的典型故障。
//
// `markPostCompaction()` 是另一件事：在 bootstrap state 上打个时间戳，
// 让其他地方能查"刚刚压缩过"。两个调用解决两个问题，别混。
    // Reset cache read baseline so the post-compact drop isn't flagged as a break
    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      notifyCompaction(
        context.options.querySource ?? 'compact',
        context.agentId,
      )
    }
    markPostCompaction()

// ═══ 重新追加会话元数据 ═══
//
// 场景：用户给会话起了个名字（`/rename 修登录 bug`）。这个名字存在
// transcript 文件的**末尾**，`--resume` 列表靠读最后 16KB 来显示它。
//
// 压缩之后会往 transcript 里写一大堆新消息（摘要、附件…），
// 把那条元数据挤出 16KB 窗口 → `--resume` 列表显示的是自动生成的标题，
// 用户起的名字没了。
//
// 解法就是在压缩后重新追加一遍（重复了也没关系，读的时候取最后一条）。
//
// 【这是一个"窗口型存储"的经典坑】
// 任何"只读文件尾部 N KB"的设计，都要考虑"如果后面又写了东西怎么办"。
// 这里的答案是"重要元数据每次写完都重追加一次"。
// 简单粗暴，但比改成扫全文件（大 transcript 会慢）划算。
    // Re-append session metadata (custom title, tag) so it stays within
    // the 16KB tail window that readLiteMetadata reads for --resume display.
    // Without this, enough post-compaction messages push the metadata entry
    // out of the window, causing --resume to show the auto-generated title
    // instead of the user-set session name.
    reAppendSessionMetadata()

// KAIROS 专有：把压缩前的消息写成一个"精简 transcript 段"。
//
// `void` 前缀 = 不 await，fire-and-forget。注释说
// "errors are logged internally"——内部自己 try/catch 了，
// 失败不会影响压缩流程。
//
// 【为什么可以不等】
// 这个写盘操作对**当前这次压缩**没有任何影响——它只是归档。
// 等它反而会让用户多等几十毫秒。这类"日志/归档"操作
// 基本都是 fire-and-forget，`void` 前缀就是标记。
    // Write a reduced transcript segment for the pre-compaction messages
    // (assistant mode only). Fire-and-forget — errors are logged internally.
    if (feature('KAIROS')) {
      void sessionTranscriptModule?.writeSessionTranscriptSegment(messages)
    }

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'post_compact',
    })
    const postCompactHookResult = await executePostCompactHooks(
      {
        trigger: isAutoCompact ? 'auto' : 'manual',
        compactSummary: summary,
      },
      context.abortController.signal,
    )

// 把两个来源的显示消息拼起来：PreCompact hook 的 + PostCompact hook 的。
//
// `.filter(Boolean)` 去掉空值，`.join('
// ')` 用换行连接。
// 最后 `|| undefined` 把空字符串转成 undefined——保持 CompactionResult
// 的类型契约（要么有内容要么没有，不要空串）。
//
// 这个显示消息会在 UI 上显示给用户（比如 hook 说"已把 schema 变更写入摘要"）。
// 它**不发给模型**，纯 UI 用途。
    const combinedUserDisplayMessage = [
      userDisplayMessage,
      postCompactHookResult.userDisplayMessage,
    ]
      .filter(Boolean)
      .join('\n')

    return {
      boundaryMarker,
      summaryMessages,
      attachments: postCompactFileAttachments,
      hookResults: hookMessages,
      userDisplayMessage: combinedUserDisplayMessage || undefined,
      preCompactTokenCount,
      postCompactTokenCount: compactionCallTotalTokens,
      truePostCompactTokenCount,
      compactionUsage,
    }
// ═══ catch 里的判断很重要 ═══
//
// 注释：
//   "Only show the error notification for manual /compact.
//    Auto-compact failures are retried on the next turn and the
//    notification is confusing when compaction eventually succeeds."
//
// 翻译：只有用户手动 `/compact` 失败才弹错误通知。
// 自动压缩失败**不弹**，因为：
//   · 下一轮会再试（`autoCompactionFailureCount` 那个熔断计数还没到 3）
//   · 如果真的下一轮成功了，用户会看到"出错了"然后又"好了"——莫名其妙
//
// 这是一个很实用的 UI 原则：**对"会自动重试的操作"，不要报瞬时失败**。
// 只在"彻底放弃"时才打扰用户。
  } catch (error) {
    // Only show the error notification for manual /compact.
    // Auto-compact failures are retried on the next turn and the
    // notification is confusing when compaction eventually succeeds.
    if (!isAutoCompact) {
      addErrorNotificationIfNeeded(error, context)
    }
    throw error
// finally 里四件事，每一件漏了都有具体后果：
//
//   setStreamMode('requesting')   → 不设的话 UI 卡在"正在响应"
//   setResponseLength(() => 0)    → 不重置的话字符计数器保留旧值，
//                                   下一轮显示的字数从上次的位置继续涨
//   onCompactProgress(compact_end)→ 不发的的话进度条永远不消失
//   setSDKStatus(null)            → SDK 客户端一直以为在 compacting
//
// 【注意 758 行和 836 行、758 和 1101 行是三处重复】
// `compactConversation`、`partialCompactConversation` 两个函数的 finally
// 完全一样。这是可以抽出去的重复，但没抽——大概是怕抽成函数后
// 有人只改一处。这类"刻意保留的重复"在长函数里很常见。
//
// `setResponseLength(() => 0)` 传的是**函数**不是值，因为它内部
// 是 `setState(prev => ...)` 的形式，传函数才能拿到最新值。
  } finally {
    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_end' })
    context.setSDKStatus?.(null)
  }
}

// ═══════════════════════════════════════════════════════════════
// 局部压缩（335 行，772-1106）
//
// 和全量压缩的区别：只压一半，另一半**原样保留**。
// 分界点由用户在消息选择器（按两次 Esc 打开）里手动指定。
//
// 【两个方向，名字很容易记反，注释专门解释了】
//
//   direction = 'from'   → 摘要 pivotIndex **之后**的消息，保留之前的
//                          （"从这条往后压掉"）
//                          保留段在前 → **prompt cache 保留**
//
//   direction = 'up_to'  → 摘要 pivotIndex **之前**的消息，保留之后的
//                          （"压到这条为止"）
//                          摘要在前 → **prompt cache 失效**
//
// 注意最后两行：拖住缓存的是"保留段是否在最前面"。
// 因为 prompt cache 是**前缀缓存**——只有从头开始连续相同的部分才能命中。
// 'from' 方向保留的是开头，所以缓存还在；'up_to' 方向开头就换成了摘要，
// 缓存必然全废。
//
// 这个结论直接影响 852 行那个优化：'from' 方向要发 **全部消息**
// （包括要被摘要掉的尾巴），因为尾巴单独发不会命中缓存，
// 不如带着完整历史发，让前缀至少能命中。
// ═══════════════════════════════════════════════════════════════
/**
 * Performs a partial compaction around the selected message index.
 * Direction 'from': summarizes messages after the index, keeps earlier ones.
 *   Prompt cache for kept (earlier) messages is preserved.
 * Direction 'up_to': summarizes messages before the index, keeps later ones.
 *   Prompt cache is invalidated since the summary precedes the kept messages.
 */
export async function partialCompactConversation(
  allMessages: Message[],
  pivotIndex: number,
  context: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  userFeedback?: string,
  direction: PartialCompactDirection = 'from',
): Promise<CompactionResult> {
  try {
    const messagesToSummarize =
      direction === 'up_to'
        ? allMessages.slice(0, pivotIndex)
        : allMessages.slice(pivotIndex)
// ═══ 这段注释解释了一个非对称的过滤规则，非常值得细读 ═══
//
// `messagesToKeep` 在 'up_to' 方向要**额外**剥掉三种东西：
//   · progress 消息（两个方向都剥）
//   · 旧的 compact boundary
//   · 旧的压缩摘要（`isCompactSummary` 的 user 消息）
//
// 为什么 'from' 方向**不**剥？注释给了两个理由，都很微妙：
//
//   理由 1："for 'up_to', summary_B sits BEFORE kept, so a stale boundary_A
//            in kept wins findLastCompactBoundaryIndex's backward scan
//            and drops summary_B."
//   ——'up_to' 时，保留下来的段里可能藏着一个**旧的** boundary_A。
//     而 `findLastCompactBoundaryIndex` 是**从后往前扫**找最后一个 boundary。
//     如果保留段里有旧的 A，它会**盖住**新写入的 summary_B，
//     导致加载器以为最后一条边界是 A，把 B 之后的内容全当成"压缩前"丢掉。
//
//   理由 2："'from' keeps them: summary_B sits AFTER kept (backward scan
//            still works), and removing an old summary would lose its
//            covered history."
//   ——'from' 时新摘要在**后面**，向后扫描先看到 B 再看 A，顺序正确。
//     而且删掉旧摘要会丢掉它覆盖的那段历史（那是唯一记录）。
//
// 【这段注释的教学价值极高】
// 它展示了一种思考方式：**不是"该不该删"，而是"删了之后扫描顺序会不会错"**。
// 同一个操作在两个分支里效果相反，原因不在操作本身，在于
// **下游有一个依赖方向的扫描**。
//
// 读这种代码时，先去找那个"下游扫描"（`findLastCompactBoundaryIndex`），
// 才能理解为什么两边规则不一样。否则只会觉得"这里写得不一致，是不是 bug"。
    // 'up_to' must strip old compact boundaries/summaries: for 'up_to',
    // summary_B sits BEFORE kept, so a stale boundary_A in kept wins
    // findLastCompactBoundaryIndex's backward scan and drops summary_B.
    // 'from' keeps them: summary_B sits AFTER kept (backward scan still
    // works), and removing an old summary would lose its covered history.
    const messagesToKeep =
      direction === 'up_to'
        ? allMessages
            .slice(pivotIndex)
            .filter(
              m =>
                m.type !== 'progress' &&
                !isCompactBoundaryMessage(m) &&
                !(m.type === 'user' && m.isCompactSummary),
            )
        : allMessages.slice(0, pivotIndex).filter(m => m.type !== 'progress')

// 空输入检查，两个方向各有各的文案。
//
// 注意这里**没有**像全量压缩那样检查 `allMessages.length === 0`——
// 因为局部压缩的前提就是"有消息让你选分界点"，不可能空。
// 只可能"选了第一条"（'up_to' 时前面没东西）或"选了最后一条"（'from' 时后面没东西）。
    if (messagesToSummarize.length === 0) {
      throw new Error(
        direction === 'up_to'
          ? 'Nothing to summarize before the selected message.'
          : 'Nothing to summarize after the selected message.',
      )
    }

    const preCompactTokenCount = tokenCountWithEstimation(allMessages)

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'pre_compact',
    })

    context.setSDKStatus?.('compacting')
    const hookResult = await executePreCompactHooks(
      {
        trigger: 'manual',
        customInstructions: null,
      },
      context.abortController.signal,
    )

// 三个分支拼 `customInstructions`，优先级：
//   hook 指令 + 用户反馈  → 都拼上，hook 在前
//   只有 hook 指令         → 用它
//   只有用户反馈           → 包一层 `User context: `
//
// 注意这里和全量压缩的 `mergeHookInstructions`（374 行）**不一致**：
// 那边是"用户在前、hook 在后"，这边是"hook 在前、用户在后"。
//
// 为什么？因为语义不同：
//   · 全量压缩：`customInstructions` 是用户主动写的压缩指令
//     （`/compact 关注登录逻辑`），和 hook 是同级的"指令"
//   · 局部压缩：`userFeedback` 是用户对**这段对话**的补充说明
//     （"这里在排查 XXX bug"），是**上下文信息**不是指令，
//     所以放在 hook 的正式指令后面
//
// `User context: ` 这个前缀就是为了明确区分这两种性质。
//
// 【这是一处真实的不一致，但是合理的不一致】
// 读代码时看到两处"合并指令"逻辑不同，不要急着判定哪个是 bug。
// 先看两边输入的语义是不是同一类东西。
    // Merge hook instructions with user feedback
    let customInstructions: string | undefined
    if (hookResult.newCustomInstructions && userFeedback) {
      customInstructions = `${hookResult.newCustomInstructions}\n\nUser context: ${userFeedback}`
    } else if (hookResult.newCustomInstructions) {
      customInstructions = hookResult.newCustomInstructions
    } else if (userFeedback) {
      customInstructions = `User context: ${userFeedback}`
    }

    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_start' })

    const compactPrompt = getPartialCompactPrompt(customInstructions, direction)
    const summaryRequest = createUserMessage({
      content: compactPrompt,
    })

    const failureMetadata = {
      preCompactTokenCount,
      direction:
        direction as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      messagesSummarized: messagesToSummarize.length,
    }

// ═══ 全文件最反直觉的一行 ═══
//
//   `let apiMessages = direction === 'up_to' ? messagesToSummarize : allMessages`
//
// 'from' 方向明明只需要摘要**后半段**，为什么要发**全部消息**？
//
// 注释答案："'from' prefix hits cache directly; 'from' sends all
// (tail wouldn't cache)."
//
// 展开说：
//   · 'up_to'：发前半段。这半段就是对话的开头，前缀完整 →
//     **能命中主线程的 prompt cache**，省钱
//   · 'from'：要摘要的是后半段。如果只发后半段，它的开头是
//     对话中间某处——和主线程缓存的前缀对不上 → **完全不命中**，
//     全部按全价 cache_creation 计费
//   · 既然都不命中，不如把完整历史都发过去。至少：
//       1. 摘要质量更好（有完整上下文）
//       2. 前缀部分（system + tools + 前半段）仍然能命中缓存
//
// 【这是一个"省钱的直觉反而费钱"的例子】
// 直觉：少发点 = 少花点。
// 实际：缓存是按前缀命中的，砍掉开头 = 前缀全废 = 每一段都全价。
//
// 下一行 853 的注释还补了一句："PTL retry breaks the cache prefix
// but unblocks the user (CC-1180)"——截断重试会破坏前缀，
// 但那是为了让人能用，值得。
    // 'up_to' prefix hits cache directly; 'from' sends all (tail wouldn't cache).
    // PTL retry breaks the cache prefix but unblocks the user (CC-1180).
    let apiMessages = direction === 'up_to' ? messagesToSummarize : allMessages
    let retryCacheSafeParams =
      direction === 'up_to'
        ? { ...cacheSafeParams, forkContextMessages: messagesToSummarize }
        : cacheSafeParams
    let summaryResponse: AssistantMessage
    let summary: string | null
    let ptlAttempts = 0
    for (;;) {
      summaryResponse = await streamCompactSummary({
        messages: apiMessages,
        summaryRequest,
        appState: context.getAppState(),
        context,
        preCompactTokenCount,
        cacheSafeParams: retryCacheSafeParams,
      })
      summary = getAssistantMessageText(summaryResponse)
      if (!summary?.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)) break

// PTL 重试，和全量压缩那段（450-491）逻辑一样。
// 唯一的差别是这里操作的是 `apiMessages`（可能是 allMessages），
// 而不是 `messagesToSummarize`。
//
// 注意 877 行截断的还是 `apiMessages` —— 对的，因为要截的是
// **发给 API 的那份**。`messagesToSummarize` 保持不变，
// 它决定的是"最终摘要覆盖哪一段"，不是"这次请求发什么"。
      ptlAttempts++
      const truncated =
        ptlAttempts <= MAX_PTL_RETRIES
          ? truncateHeadForPTLRetry(apiMessages, summaryResponse)
          : null
      if (!truncated) {
        logEvent('tengu_partial_compact_failed', {
          reason:
            'prompt_too_long' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...failureMetadata,
          ptlAttempts,
        })
        throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG)
      }
      logEvent('tengu_compact_ptl_retry', {
        attempt: ptlAttempts,
        droppedMessages: apiMessages.length - truncated.length,
        remainingMessages: truncated.length,
        path: 'partial' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      apiMessages = truncated
      retryCacheSafeParams = {
        ...retryCacheSafeParams,
        forkContextMessages: truncated,
      }
    }
    if (!summary) {
      logEvent('tengu_partial_compact_failed', {
        reason:
          'no_summary' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...failureMetadata,
      })
      throw new Error(
        'Failed to generate conversation summary - response did not contain valid text content',
      )
    } else if (startsWithApiErrorPrefix(summary)) {
      logEvent('tengu_partial_compact_failed', {
        reason:
          'api_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...failureMetadata,
      })
      throw new Error(summary)
    }

// 又一次"先快照后清空"，和 517-522 完全一样。
// 三行代码重复了，但没抽函数——因为中间隔着 400 行，抽出去反而不好读。
    // Store the current file state before clearing
    const preCompactReadFileState = cacheToObject(context.readFileState)
    context.readFileState.clear()
    context.loadedNestedMemoryPaths?.clear()
    // Intentionally NOT resetting sentSkillNames — see compactConversation()
    // for rationale (~4K tokens saved per compact event).

    const [fileAttachments, asyncAgentAttachments] = await Promise.all([
      createPostCompactFileAttachments(
        preCompactReadFileState,
        context,
        POST_COMPACT_MAX_FILES_TO_RESTORE,
        messagesToKeep,
      ),
      createAsyncAgentAttachmentsIfNeeded(context),
    ])

    const postCompactFileAttachments: AttachmentMessage[] = [
      ...fileAttachments,
      ...asyncAgentAttachments,
    ]
    const planAttachment = createPlanAttachmentIfNeeded(context.agentId)
    if (planAttachment) {
      postCompactFileAttachments.push(planAttachment)
    }

    // Add plan mode instructions if currently in plan mode
    const planModeAttachment = await createPlanModeAttachmentIfNeeded(context)
    if (planModeAttachment) {
      postCompactFileAttachments.push(planModeAttachment)
    }

    const skillAttachment = createSkillAttachmentIfNeeded(context.agentId)
    if (skillAttachment) {
      postCompactFileAttachments.push(skillAttachment)
    }

// ═══ 和全量压缩的关键差异：传 `messagesToKeep` 而不是 `[]` ═══
//
// 全量压缩时历史被吃光了，所以要"跟空集合做 diff"= 全量宣告。
//
// 局部压缩时保留段还在，所以传 `messagesToKeep`：
// **已经在保留段里宣告过的东西会跳过**，只补被摘要掉的那部分。
//
// 注释原话："Re-announce only what was in the summarized portion —
// messagesToKeep is scanned, so anything already announced there is skipped."
//
// 【这一处对比把"delta attachment"的语义彻底讲清了】
// 同一个函数，参数不同：
//   传 []              → 全量
//   传 messagesToKeep  → 只补差集
//
// 这才是"diff"的正确用法。前面 567 行传 `[]` 是个特例（假装空历史）。
    // Re-announce only what was in the summarized portion — messagesToKeep
    // is scanned, so anything already announced there is skipped.
    for (const att of getDeferredToolsDeltaAttachment(
      context.options.tools,
      context.options.mainLoopModel,
      messagesToKeep,
      { callSite: 'compact_partial' },
    )) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }
    for (const att of getAgentListingDeltaAttachment(context, messagesToKeep)) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }
    for (const att of getMcpInstructionsDeltaAttachment(
      context.options.mcpClients,
      context.options.tools,
      context.options.mainLoopModel,
      messagesToKeep,
    )) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'session_start',
    })
    const hookMessages = await processSessionStartHooks('compact', {
      model: context.options.mainLoopModel,
    })

    const postCompactTokenCount = tokenCountFromLastAPIResponse([
      summaryResponse,
    ])
    const compactionUsage = getTokenUsage(summaryResponse)

    logEvent('tengu_partial_compact', {
      preCompactTokenCount,
      postCompactTokenCount,
      messagesKept: messagesToKeep.length,
      messagesSummarized: messagesToSummarize.length,
      direction:
        direction as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      hasUserFeedback: !!userFeedback,
      trigger:
        'message_selector' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      compactionInputTokens: compactionUsage?.input_tokens,
      compactionOutputTokens: compactionUsage?.output_tokens,
      compactionCacheReadTokens: compactionUsage?.cache_read_input_tokens ?? 0,
      compactionCacheCreationTokens:
        compactionUsage?.cache_creation_input_tokens ?? 0,
    })

// ═══ 一个非常隐蔽的崩溃点 ═══
//
//   "Progress messages aren't loggable, so forkSessionImpl would null out
//    a logicalParentUuid pointing at one. Both directions skip them."
//
// 场景：局部压缩要记录"压缩前最后一条消息的 uuid"，作为新边界的父节点。
// 如果那条恰好是 `progress` 类型（子 agent 的进度更新），就会出问题——
// 因为 progress 消息**不写进 transcript**（不是可记录的消息类型）。
//
// 于是 `forkSessionImpl` 在重建父子链时发现"父节点不存在"，
// 只能把 `logicalParentUuid` 设成 null → 链路断开 → `--resume` 出孤儿。
//
// 解法：两个方向都跳过 progress，往前找第一条"真实"消息。
//
// 【注意 1011 行用了 `findLast`】
// 它是从后往前找，不是 `filter().at(-1)`。后者会创建一个新数组，
// 在长会话上白白分配内存。`findLast` 是 ES2023 的方法，
// 找到第一个就停——这个选择是有意的性能考虑。
    // Progress messages aren't loggable, so forkSessionImpl would null out
    // a logicalParentUuid pointing at one. Both directions skip them.
    const lastPreCompactUuid =
      direction === 'up_to'
        ? allMessages.slice(0, pivotIndex).findLast(m => m.type !== 'progress')
            ?.uuid
        : messagesToKeep.at(-1)?.uuid
    const boundaryMarker = createCompactBoundaryMessage(
      'manual',
      preCompactTokenCount ?? 0,
      lastPreCompactUuid,
      userFeedback,
      messagesToSummarize.length,
    )
// 用 `allMessages` 而不是 `messagesToSummarize` 来提取已加载工具。
//
// 理由注释写得很清楚："set union is idempotent, simpler than tracking
// which half each tool lived in."
//
// 翻译：反正两边都要扫，扫全部再取并集，结果一定是对的
// （一个工具无论出现在哪半边，都该被算作"已加载"）。
// 而如果只扫 `messagesToSummarize`，就会漏掉保留段里的那些——
// 那些其实也还在上下文里，不该重新加载。
//
// 【"取并集比判断归属简单"是一种很好的偷懒】
// 当两个集合的并集就是你要的答案时，不要去算"哪个元素属于哪个集合"。
// 这里省掉的分支判断，比多扫一遍数组的代价小得多。
    // allMessages not just messagesToSummarize — set union is idempotent,
    // simpler than tracking which half each tool lived in.
    const preCompactDiscovered = extractDiscoveredToolNames(allMessages)
    if (preCompactDiscovered.size > 0) {
      boundaryMarker.compactMetadata.preCompactDiscoveredTools = [
        ...preCompactDiscovered,
      ].sort()
    }

// ═══ 这里有个条件分支，决定了摘要消息"好不好看" ═══
//
//   `messagesToKeep.length > 0` → 挂 `summarizeMetadata`
//   否则（没保留任何消息）      → 挂 `isVisibleInTranscriptOnly: true`
//
// 区别：
//   · `summarizeMetadata`：让 UI 能显示"已摘要 42 条消息（方向 from，
//     用户备注 XXX）"。有这个元数据，UI 就能画一个可展开的摘要卡片
//   · `isVisibleInTranscriptOnly`：只在 transcript 里可见，UI 不显示。
//     用于"这次压缩把一切都吃掉了"的情况——此时摘要就是全部上下文，
//     显示成一张卡片反而奇怪（用户会以为下面是空的）
//
// 【注意 `as const`】
// `isVisibleInTranscriptOnly: true as const` 里的 `as const` 是必需的，
// 因为在一个三元里 TS 会把 `true` 推成 `boolean`，而 UserMessage 类型
// 要求的是字面量 `true`。这类细节在条件 spread 里很常见。
//
// 对比全量压缩（621-622 行）：那边**无条件**设
// `isCompactSummary: true` + `isVisibleInTranscriptOnly: true`，
// 因为全量压缩永远没有保留段。
    const transcriptPath = getTranscriptPath()
    const summaryMessages: UserMessage[] = [
      createUserMessage({
        content: getCompactUserSummaryMessage(summary, false, transcriptPath),
        isCompactSummary: true,
        ...(messagesToKeep.length > 0
          ? {
              summarizeMetadata: {
                messagesSummarized: messagesToSummarize.length,
                userContext: userFeedback,
                direction,
              },
            }
          : { isVisibleInTranscriptOnly: true as const }),
      }),
    ]

    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      notifyCompaction(
        context.options.querySource ?? 'compact',
        context.agentId,
      )
    }
    markPostCompaction()

    // Re-append session metadata (custom title, tag) so it stays within
    // the 16KB tail window that readLiteMetadata reads for --resume display.
    reAppendSessionMetadata()

    if (feature('KAIROS')) {
      void sessionTranscriptModule?.writeSessionTranscriptSegment(
        messagesToSummarize,
      )
    }

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'post_compact',
    })
    const postCompactHookResult = await executePostCompactHooks(
      {
        trigger: 'manual',
        compactSummary: summary,
      },
      context.abortController.signal,
    )

// ═══ anchorUuid 随方向变化（对应 340 行那段注释的实现） ═══
//
//   'up_to' → `summaryMessages.at(-1)?.uuid`
//             摘要在前、保留段在后 → 保留段接在**最后一条摘要消息**后面
//
//   'from'  → `boundaryMarker.uuid`
//             保留段在前、摘要在后 → 保留段接在**边界**后面
//             （此时边界是第一条，保留段紧跟它）
//
// `?? boundaryMarker.uuid` 是兜底：万一 summaryMessages 为空
// （理论上不可能，上面已经检查过），退回用边界。
//
// 【这个三元表达式是整个"保留段重连"机制的最后一块拼图】
//   349 行 annotateBoundaryWithPreservedSegment：写元数据
//   1078 行 这里：算出 anchor
//   两者配合，--resume 才能把断掉的链接回去
//
// 如果搞反了会怎样？保留段会接到错误的位置，出现
// "历史消息顺序乱了"或者"部分消息丢失"——而且只在 --resume 时能看出来，
// 当场调试根本发现不了。
    // 'from': prefix-preserving → boundary; 'up_to': suffix → last summary
    const anchorUuid =
      direction === 'up_to'
        ? (summaryMessages.at(-1)?.uuid ?? boundaryMarker.uuid)
        : boundaryMarker.uuid
    return {
      boundaryMarker: annotateBoundaryWithPreservedSegment(
        boundaryMarker,
        anchorUuid,
        messagesToKeep,
      ),
      summaryMessages,
      messagesToKeep,
      attachments: postCompactFileAttachments,
      hookResults: hookMessages,
      userDisplayMessage: postCompactHookResult.userDisplayMessage,
      preCompactTokenCount,
      postCompactTokenCount,
      compactionUsage,
    }
// 局部压缩**无条件**弹错误通知，和全量压缩不同（那边判 `if (!isAutoCompact)`）。
//
// 因为局部压缩只有手动触发（用户在消息选择器里点出来的），
// 不存在"自动重试所以别打扰"的情况。失败就是失败，必须告诉用户。
  } catch (error) {
    addErrorNotificationIfNeeded(error, context)
    throw error
  } finally {
    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_end' })
    context.setSDKStatus?.(null)
  }
}

// 弹错误通知，但有两种错误不弹。
//
// `hasExactErrorMessage` 是**精确字符串比对**（不是 includes），
// 因为这里要区分的是"我们主动抛的两种非故障错误"：
//   · `ERROR_MESSAGE_USER_ABORT`        —— 用户按了 Esc
//   · `ERROR_MESSAGE_NOT_ENOUGH_MESSAGES` —— 消息太少不用压
//
// 两种都是"用户的意图"，不是故障。弹红色错误框会让人以为系统坏了。
//
// 【这也解释了 225 行那三个常量为什么必须是常量】
// 如果这里是 `error.message.includes('abort')` 之类，
// 用户按 Esc 时就会弹错误。用精确比对 + 共享常量，
// 才能保证"文案改了但行为不变"——除非有人只改了一处。
//
// 通知的 key 是 `error-compacting-conversation`，固定字符串意味着
// 重复出错只会覆盖同一条通知，不会刷屏。`priority: 'immediate'`
// 让它插队显示（不等当前渲染周期）。
function addErrorNotificationIfNeeded(
  error: unknown,
  context: Pick<ToolUseContext, 'addNotification'>,
) {
  if (
    !hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT) &&
    !hasExactErrorMessage(error, ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)
  ) {
    context.addNotification?.({
      key: 'error-compacting-conversation',
      text: 'Error compacting conversation',
      priority: 'immediate',
      color: 'error',
    })
  }
}

// ═══ 压缩 agent 的工具权限：全 deny ═══
//
// 返回的每一句都是固定拒绝，`decisionReason.type: 'other'`。
//
// 为什么必须全禁？因为压缩 agent 的任务是"写一段文字摘要"。
// 如果它被允许调工具，会出现这些灾难：
//   · 它可能去 Read 一堆文件，把上下文又撑大了（压缩的意义全没了）
//   · 它可能写文件、跑命令——一个"整理历史"的操作不该有副作用
//   · 它可能递归触发压缩
//
// 注释里那句 "compaction agent should only produce text summary"
// 就是这个意思：**能力最小化**。
//
// 【顺带一提：这个函数返回的是 `CanUseToolFn`】
// 它的签名是 `(toolName, input) => Promise<PermissionResult>`。
// 这里连参数都没接，直接返回 deny——连"是什么工具"都不看。
// 这是最彻底的禁法。
export function createCompactCanUseTool(): CanUseToolFn {
  return async () => ({
    behavior: 'deny' as const,
    message: 'Tool use is not allowed during compaction',
    decisionReason: {
      type: 'other' as const,
      reason: 'compaction agent should only produce text summary',
    },
  })
}

// ═══════════════════════════════════════════════════════════════
// 摘要生成（261 行，1136-1396）—— 真正发那次 API 调用
//
// 【两条路径，一主一备】
//
//   主路径（1179-1248）：runForkedAgent
//     ——复用主线程的 prompt cache。命中率极高（system + tools + 历史前缀全同），
//        成本约为普通路径的 1/10。失败时静默回退。
//
//   备路径（1250-1389）：queryModelWithStreaming
//     ——普通流式请求，system prompt 只有一句话，工具只有 FileReadTool。
//        贵，但简单可靠。
//
// 【为什么要"分叉一个 agent"而不是直接调 API】
// 因为只有走 `query()` 那条路，才能保证发出去的参数（system / tools /
// model / thinking config / 消息前缀）**与主线程逐字节相同**。
// 任何一个参数不同，prompt cache 就不命中。
//
// 这也是为什么 1181 行那段注释死活不让设 `maxOutputTokens`——
// 后面细讲，那是全文件最精妙的一处。
// ═══════════════════════════════════════════════════════════════
async function streamCompactSummary({
  messages,
  summaryRequest,
  appState,
  context,
  preCompactTokenCount,
  cacheSafeParams,
}: {
  messages: Message[]
  summaryRequest: UserMessage
  appState: Awaited<ReturnType<ToolUseContext['getAppState']>>
  context: ToolUseContext
  preCompactTokenCount: number
  cacheSafeParams: CacheSafeParams
}): Promise<AssistantMessage> {
// 注释说 "Falls back to regular streaming path on failure"。
//
// 注意"失败"包含两类：
//   · 抛异常（1240 行的 catch）
//   · 没拿到有效文本（1231 行）
//
// 两类都**静默**回退，只打一个 `tengu_compact_cache_sharing_fallback` 埋点。
// 不弹任何用户可见的错误——因为回退本身是正常的，
// 用户只关心"压缩有没有成功"，不关心走的是哪条路。
//
// 【这个开关在同一个文件里被读了两次】
//   435 行：决定要不要打 `promptCacheSharingEnabled` 进埋点
//   1155 行：决定走哪条路径
//
// 两处读同一个 GrowthBook key，值一样（都是 CACHED_MAY_BE_STALE）。
// 但 435 行那次读是在 `compactConversation` 里，1155 行在
// `streamCompactSummary` 里——后者是被前者调用的。
// 所以同一次压缩里读了两遍同一个配置。
//
// 【这不是 bug，但是一个隐患】
// `getFeatureValue_CACHED_MAY_BE_STALE` 的语义是"可能过期"。
// 如果两次读之间 GrowthBook 刷新了，埋点里记的值和实际走的路径会不一致。
// 概率很低（同一个函数调用内），但埋点数据就不可靠了。
  // When prompt cache sharing is enabled, use forked agent to reuse the
  // main conversation's cached prefix (system prompt, tools, context messages).
  // Falls back to regular streaming path on failure.
  // 3P default: true — see comment at the other tengu_compact_cache_prefix read above.
  const promptCacheSharingEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_compact_cache_prefix',
    true,
  )
  // Send keep-alive signals during compaction to prevent remote session
  // WebSocket idle timeouts from dropping bridge connections. Compaction
  // API calls can take 5-10+ seconds, during which no other messages
  // flow through the transport — without keep-alives, the server may
  // close the WebSocket for inactivity.
  // Two signals: (1) PUT /worker heartbeat via sessionActivity, and
  // (2) re-emit 'compacting' status so the SDK event stream stays active
  // and the server doesn't consider the session stale.
// ═══ 每 30 秒的保活信号，这个设计值得讲 ═══
//
// 注释：
//   "Compaction API calls can take 5-10+ seconds, during which no other
//    messages flow through the transport — without keep-alives, the server
//    may close the WebSocket for inactivity."
//
// 场景：远程会话（CCR / 云端）通过 WebSocket 连着服务端。压缩期间
// 5-10 秒没有任何消息流动 → 服务端认为连接空闲 → 关掉 WebSocket
// → 压缩结果回不来，用户看到"中断"。
//
// 两种保活信号：
//   1. `sendSessionActivitySignal()` —— PUT /worker 心跳
//   2. `statusSetter?.('compacting')` —— 重新发一次状态事件，
//      让 SDK 事件流保持活跃
//
// 【`setInterval` 的第三个参数是个巧思】
//   `setInterval(fn, 30_000, context.setSDKStatus)`
//
// `setInterval` 支持在延迟之后传**额外的参数**，它们会被原样传给回调。
// 所以这里的回调签名写成 `(statusSetter?) => {...}`，
// 靠这个参数拿到 `setSDKStatus`。
//
// 为什么不在闭包里直接用 `context.setSDKStatus`？因为那样
// 每 30 秒都要解引用一次 `context` 对象，而这个闭包会活很久。
// 传参是把值**捕获在定时器注册时**——虽然实际上 `context` 也一样被捕获了……
//
// 【老实说这个写法没多少性能收益】
// 它更大的价值是**显式表达依赖**：读代码的人一眼看到
// "这个定时器需要 setSDKStatus"，而不用翻回调体去找。
//
// 注意 `activityInterval` 可能是 `undefined`（不在远程会话时），
// 1394 行的 `clearInterval(undefined)` 是合法的空操作。
  const activityInterval = isSessionActivityTrackingActive()
    ? setInterval(
        (statusSetter?: (status: 'compacting' | null) => void) => {
          sendSessionActivitySignal()
          statusSetter?.('compacting')
        },
        30_000,
        context.setSDKStatus,
      )
    : undefined

  try {
    if (promptCacheSharingEnabled) {
      try {
// ═══ 这是全文件最精妙的一段注释，逐句拆 ═══
//
//   "DO NOT set maxOutputTokens here. The fork piggybacks on the main thread's
//    prompt cache by sending identical cache-key params (system, tools, model,
//    messages prefix, thinking config)."
//
// 第一句：不要在这里设 maxOutputTokens。为什么？因为分叉出来的 agent
// 要复用主线程的缓存，前提是**缓存键参数完全相同**。缓存键包含
// system / tools / model / 消息前缀 / **thinking config**。
//
//   "Setting maxOutputTokens would clamp budget_tokens via
//    Math.min(budget, maxOutputTokens-1) in claude.ts, creating a thinking
//    config mismatch that invalidates the cache."
//
// 第二句才是关键：在 claude.ts 里，`maxOutputTokens` 会**间接改动
// thinking config**——具体是 `budget_tokens = Math.min(budget, maxOutputTokens - 1)`。
//
// 也就是说：
//   · 主线程：maxOutputTokens = 32000 → budget_tokens = min(10000, 31999) = 10000
//   · 压缩设了 8000：→ budget_tokens = min(10000, 7999) = **7999**
//
// 7999 ≠ 10000，thinking config 变了 → **整个缓存作废**。
//
// 而如果你觉得"那我干脆把 thinking 关掉？"——也不行，因为
// `thinkingConfig` 本身就在缓存键里，关掉同样不命中。
//
// 【最狠的一点：这个耦合是隐式的】
// 设 `maxOutputTokens` 的人根本想不到它会改 `budget_tokens`；
// 改 `budget_tokens` 的人想不到它会毁掉缓存。两个模块
// （compact.ts 和 claude.ts）之间靠一个 `Math.min` 隐式耦合。
// 唯一的防御就是这段注释。
//
//   "The streaming fallback path (below) can safely set maxOutputTokensOverride
//    since it doesn't share cache with the main thread."
//
// 最后一句给了出路：备路径（1317 行）可以随便设，因为它本来就不共享缓存。
// 所以你会看到同一个文件里，一条路径严禁设、另一条路径必须设——
// **看起来矛盾，实际完全合理**。读到这里如果不看注释，一定会以为写错了。
        // DO NOT set maxOutputTokens here. The fork piggybacks on the main thread's
        // prompt cache by sending identical cache-key params (system, tools, model,
        // messages prefix, thinking config). Setting maxOutputTokens would clamp
        // budget_tokens via Math.min(budget, maxOutputTokens-1) in claude.ts,
        // creating a thinking config mismatch that invalidates the cache.
        // The streaming fallback path (below) can safely set maxOutputTokensOverride
        // since it doesn't share cache with the main thread.
// 五个参数，每个都有讲究：
//
//   promptMessages: [summaryRequest]
//     ——只传摘要指令这一条。历史从 `cacheSafeParams` 里取（那是主线程的），
//        不从这里传。这就是为什么 PTL 重试时要改 `forkContextMessages`
//        而不只是改 `messages`（487 行那段）。
//
//   canUseTool: createCompactCanUseTool()
//     ——全 deny，见 1125 行。
//
//   querySource: 'compact'
//     ——埋点归因用。`withRetry` 的 529 白名单也看这个值
//        （`querySource` 是后台路径的话不重试）。
//
//   forkLabel: 'compact'
//     ——给 UI / 日志区分不同用途的分叉（还有 'title'、'suggestion' 等）。
//
//   maxTurns: 1
//     ——只准跑一轮。多轮意味着可能有 tool_use → tool_result 循环，
//        那会浪费大量 token 且完全没有必要。
//
//   skipCacheWrite: true
//     ——**这个很重要**：不让这次请求写缓存。
//        因为压缩请求的前缀虽然和主线程相同，但它后面接的
//        （摘要指令）是临时的。如果它写缓存，会污染主线程的缓存条目，
//        让后续真实请求命中一段"末尾是摘要指令"的错误缓存。
//
//        代价：不写缓存 = 下次压缩还得重新读一遍（但读比写便宜得多，
//        而且主线程本来就会持续写，所以不影响）。
//
//   overrides: { abortController: context.abortController }
//     ——注释专门解释了：让用户按 Esc 能中断分叉，
//        和备路径的 `signal: context.abortController.signal`（1307 行）
//        用同一个信号。
        const result = await runForkedAgent({
          promptMessages: [summaryRequest],
          cacheSafeParams,
          canUseTool: createCompactCanUseTool(),
          querySource: 'compact',
          forkLabel: 'compact',
          maxTurns: 1,
          skipCacheWrite: true,
          // Pass the compact context's abortController so user Esc aborts the
          // fork — same signal the streaming fallback uses at
          // `signal: context.abortController.signal` below.
          overrides: { abortController: context.abortController },
        })
// 从分叉 agent 返回的完整消息数组里，取最后一条 assistant 消息。
//
// 因为 `maxTurns: 1`，理论上只有一条 assistant。但取"最后一条"
// 而不是"第一条"，是为了防御性容错——万一有额外的边界消息。
//
// `getAssistantMessageText` 会把 content 数组里的所有 text 块拼起来。
// 如果只有 thinking 块没有 text 块，返回空字符串/null。
        const assistantMsg = getLastAssistantMessage(result.messages)
        const assistantText = assistantMsg
          ? getAssistantMessageText(assistantMsg)
          : null
// ═══ 这个守卫是修一个真 bug 留下的 ═══
//
// 注释：
//   "Guard isApiErrorMessage: query() catches API errors (including
//    APIUserAbortError on ESC) and yields them as synthetic assistant
//    messages. Without this check, an aborted compact 'succeeds' with
//    'Request was aborted.' as the summary — the text doesn't start with
//    'API Error' so the caller's startsWithApiErrorPrefix guard misses it."
//
// 完整还原这个 bug：
//
//   1. 用户按 Esc 中断压缩
//   2. `query()` 内部 catch 住 `APIUserAbortError`，包装成一条
//      **合成的 assistant 消息**（`isApiErrorMessage: true`），
//      文本是 `"API Error: Request was aborted."`
//   3. 这个守卫**当时不存在**，所以把这条消息当成了摘要
//   4. 调用方（459 行）拿到 `summary = "API Error: Request was aborted."`
//   5. 检查 `startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)` → 不匹配，break
//   6. 检查 `startsWithApiErrorPrefix(summary)` → 这里本该抓到，
//      但注释说 "the text doesn't start with 'API Error'" ——
//      说明**某个版本的文案里没有这个前缀**（可能是
//      `'Request was aborted.'` 单独出现）
//   7. 于是压缩"成功"了，摘要内容是"请求被中断"
//   8. 用户的历史被替换成这句话 → **数据丢失**
//
// 这是一个"中断被当成成功"的经典事故。修复的关键不是改文案，
// 而是用**结构化的标志**（`isApiErrorMessage`）判断，
// 而不是靠文本前缀。这正好呼应 507 行那里用字符串判断的脆弱性。
//
// 【一条通用经验】
// 用文本匹配判断"这是不是错误"永远会漏。有结构化字段就用结构化字段。
// 这个文件里两种写法都有，正是"历史演进"的痕迹：
// 新的地方（这里）用标志位，老的地方（507 行）还在用字符串前缀。
        // Guard isApiErrorMessage: query() catches API errors (including
        // APIUserAbortError on ESC) and yields them as synthetic assistant
        // messages. Without this check, an aborted compact "succeeds" with
        // "Request was aborted." as the summary — the text doesn't start with
        // "API Error" so the caller's startsWithApiErrorPrefix guard misses it.
        if (assistantMsg && assistantText && !assistantMsg.isApiErrorMessage) {
          // Skip success logging for PTL error text — it's returned so the
          // caller's retry loop catches it, but it's not a successful summary.
// PTL 错误文本**不记 success**。
//
// 因为 PTL 是"这次没成功，调用方会砍历史重试"。如果记成 success，
// 埋点里 `tengu_compact_cache_sharing_success` 的数量会虚高，
// 而且 cacheHitRate 也会被这些本该失败的请求污染。
//
// 注意它**照样 return 了** 这条消息（1229 行）——
// 所以调用方会拿到它，走进重试循环。这里只是不打 success 埋点，不是不返回。
//
// 【这个区分很细致】
// "调用方需要知道失败" 和 "埋点需要知道失败" 是两件事：
//   · 调用方：靠返回值里的文本前缀判断（460 行）
//   · 埋点：靠这里跳过 logEvent
//
// 两处判断同一个事实，但因为信息流向不同，必须各判一次。
          if (!assistantText.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)) {
            logEvent('tengu_compact_cache_sharing_success', {
              preCompactTokenCount,
              outputTokens: result.totalUsage.output_tokens,
              cacheReadInputTokens: result.totalUsage.cache_read_input_tokens,
              cacheCreationInputTokens:
                result.totalUsage.cache_creation_input_tokens,
              cacheHitRate:
                result.totalUsage.cache_read_input_tokens > 0
                  ? result.totalUsage.cache_read_input_tokens /
                    (result.totalUsage.cache_read_input_tokens +
                      result.totalUsage.cache_creation_input_tokens +
                      result.totalUsage.input_tokens)
                  : 0,
            })
          }
          return assistantMsg
        }
// 走到这里说明分叉路径"跑完了但没拿到有效文本"。
//
// `jsonStringify(assistantMsg)` 可能是 `undefined`（一条消息都没有），
// 也可能是纯 thinking 消息。日志级别是 `warn` 不是 `error`——
// 因为回退是预期内的，不是故障。
        logForDebugging(
          `Compact cache sharing: no text in response, falling back. Response: ${jsonStringify(assistantMsg)}`,
          { level: 'warn' },
        )
        logEvent('tengu_compact_cache_sharing_fallback', {
          reason:
            'no_text_response' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          preCompactTokenCount,
        })
      } catch (error) {
        logError(error)
        logEvent('tengu_compact_cache_sharing_fallback', {
          reason:
            'error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          preCompactTokenCount,
        })
      }
    }

// ═══ 备路径：普通流式请求 ═══
//
// 和主路径的差别，列一下：
//
//              主路径（forked）            备路径（直接流式）
//   system    主线程的完整 system prompt    只有一句话
//   tools     主线程的全部工具              最多 FileReadTool + ToolSearchTool + MCP
//   历史      主线程的完整前缀              从最后一个 compact boundary 开始
//   缓存      命中                         **不命中**（前缀完全不同）
//   成本      低                            高（全价）
//   可靠性    依赖分叉机制                  简单直接
//
// 注释里那句 "Regular streaming path (fallback when cache sharing fails
// or is disabled)" 说得很平淡，但**这条路径才是保底**：
// 主路径可能因为各种原因失败（GrowthBook 关了、fork 出错、模型返回异常），
// 每次都得有一条能跑通的路。
//
// 【一个设计原则】
// 任何"为了优化而存在的复杂路径"，都必须有一条"简单但昂贵"的备胎。
// 而且备胎必须**默认能跑**——不能也需要某个开关才生效。
    // Regular streaming path (fallback when cache sharing fails or is disabled)
    const retryEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_compact_streaming_retry',
      false,
    )
    const maxAttempts = retryEnabled ? MAX_COMPACT_STREAMING_RETRIES : 1

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Reset state for retry
      let hasStartedStreaming = false
      let response: AssistantMessage | undefined
      context.setResponseLength?.(() => 0)

// 判断要不要启用工具搜索（ToolSearchTool）。
//
// 第三个参数 `async () => appState.toolPermissionContext` 是个**回调**
// 而不是值——因为 `isToolSearchEnabled` 内部要按权限过滤工具，
// 而 appState 可能在这期间变化。传回调能拿到最新值。
//
// 第五个参数 `'compact'` 是 querySource，用于埋点归因和权限判断。
//
// 【注意 1264 行的注释】
// "context.options.tools includes MCP tools merged via useMergedTools"
//
// 这是一个容易踩的坑：`appState.mcp.tools` 是**原始** MCP 工具列表
// （没经过权限过滤），而 `context.options.tools` 是合并 + 过滤后的。
// 用错了会把用户已经禁用的工具又发出去。
      // Check if tool search is enabled using the main loop's tools list.
      // context.options.tools includes MCP tools merged via useMergedTools.
      const useToolSearch = await isToolSearchEnabled(
        context.options.mainLoopModel,
        context.options.tools,
        async () => appState.toolPermissionContext,
        context.options.agentDefinitions.activeAgents,
        'compact',
      )

// ═══ 这段注释透露了一个 API 内部机制 ═══
//
//   "They get defer_loading: true and don't count against context - the API
//    filters them out of system_prompt_tools before token counting (see
//    api/token_count_api/counting.py:188 and api/public_api/messages/handler.py:324)."
//
// 翻译：带 `defer_loading: true` 的工具，API 在**计数 token 之前**
// 就把它们从工具列表里过滤掉了。也就是说：
// **发过去的工具定义不占上下文预算。**
//
// 这是"延迟加载工具"能成立的根本原因。否则把几百个 MCP 工具
// 的 schema 全塞进请求，光工具定义就几十万 token。
//
// 注释里还给了**服务端代码的路径和行号**（`counting.py:188`、
// `handler.py:324`）。这在客户端代码里非常罕见，说明有人在
// 追这个问题时真的去翻了服务端仓库，然后把证据留在了注释里。
//
// 【这类注释的价值】
// 半年后有人怀疑"defer_loading 到底占不占 token"，能直接顺着
// 行号去验证，不用重新做实验。
      // When tool search is enabled, include ToolSearchTool and MCP tools. They get
      // defer_loading: true and don't count against context - the API filters them out
      // of system_prompt_tools before token counting (see api/token_count_api/counting.py:188
      // and api/public_api/messages/handler.py:324).
      // Filter MCP tools from context.options.tools (not appState.mcp.tools) so we
      // get the permission-filtered set from useMergedTools — same source used for
      // isToolSearchEnabled above and normalizeMessagesForAPI below.
      // Deduplicate by name to avoid API errors when MCP tools share names with built-in tools.
// 三元表达式：要么"三个工具"，要么"一个工具"。
//
// 启用了工具搜索：FileReadTool + ToolSearchTool + 所有 MCP 工具
//   ——为什么压缩要 FileRead？因为摘要可能要求"引用相关文件内容"，
//      而且附件恢复机制也要读文件
//   ——为什么需要 ToolSearchTool？因为 MCP 工具是 deferred 的，
//      模型得有个东西去搜索/加载它们
//
// 没启用：只有 FileReadTool
//   ——最小集。压缩 99% 的情况只需要写摘要，不需要任何工具
//
// 【`uniqBy(..., 'name')` 是在防一个真实的 API 错误】
// 注释："Deduplicate by name to avoid API errors when MCP tools
// share names with built-in tools."
//
// MCP 服务器可以随便起名，完全可能有个叫 `Read` 的工具。
// 两个同名工具发过去，API 直接报错。
//
// 【`uniqBy` 保留第一个】
// 数组顺序是 `[FileReadTool, ToolSearchTool, ...mcpTools]`，
// 所以同名时保留内置的，丢掉 MCP 的。这个优先级是对的：
// 内置工具的语义和行为是确定的。
      const tools: Tool[] = useToolSearch
        ? uniqBy(
            [
              FileReadTool,
              ToolSearchTool,
              ...context.options.tools.filter(t => t.isMcp),
            ],
            'name',
          )
        : [FileReadTool]

// 构造流式请求。参数分两组看：
//
// 【内容组】
//   messages：
//     `getMessagesAfterCompactBoundary(messages)` —— **只取最后一个边界之后的消息**。
//       为什么要这样？因为如果之前已经压缩过一次，边界之前的消息
//       已经被摘要替代了，再发一遍纯属浪费 token（而且可能是重复的旧历史）。
//       `...summaryRequest` 追加在末尾 —— 就是"请写摘要"那条指令。
//
//     然后串了三层处理：
//       `stripReinjectedAttachments(...)`  剥掉会被重新注入的附件
//       `stripImagesFromMessages(...)`     剥掉图片
//       `normalizeMessagesForAPI(...)`     转成 API 格式（合并连续同类消息、
//                                          处理 tool_result 配对等）
//
//     **注意处理顺序**：先剥附件、再剥图、最后 normalize。
//     如果先 normalize，图片 block 可能被合并进别的结构里，就剥不掉了。
//
//   systemPrompt：只有一句话，见 1302 行
//   thinkingConfig：`disabled`
//   tools：上面 1281 行算出来的
//
// 【控制组】
//   1317 行 maxOutputTokensOverride：见那里的注释
//   1321 行 querySource: 'compact'
//   1311 行 getToolPermissionContext：又是一个回调，拿最新权限
      const streamingGen = queryModelWithStreaming({
        messages: normalizeMessagesForAPI(
          stripImagesFromMessages(
            stripReinjectedAttachments([
              ...getMessagesAfterCompactBoundary(messages),
              summaryRequest,
            ]),
          ),
          context.options.tools,
        ),
// 备路径的 system prompt 只有这一句话：
//   "You are a helpful AI assistant tasked with summarizing conversations."
//
// 对比主路径（复用主线程的完整 system prompt，约 10K token）。
//
// 这个差别不只是省 token——它彻底改变了摘要的**风格**：
//   · 主路径：摘要器带着完整的 Claude Code 人设和工具使用规范，
//     写出来的摘要会偏向"工程实现细节"
//   · 备路径：一个普通的摘要助手，写出来更通用
//
// 备路径的摘要质量通常**不如**主路径，这也是为什么主路径默认开启。
// 但备路径有个好处：**行为可预测**。它不会被主 system prompt 里的
// 各种特殊指令影响（比如"不要用 emoji"、"回答要简短"），
// 那些指令对摘要任务未必合适。
//
// `asSystemPrompt([...])` 这个包装函数是类型层面的标记，
// 把 `string[]` 转成一个带 brand 的类型——防止把用户输入误当成
// system prompt 传进去（安全问题）。
        systemPrompt: asSystemPrompt([
          'You are a helpful AI assistant tasked with summarizing conversations.',
        ]),
// 压缩时禁用 thinking。
//
// 两个理由：
//   1. **省钱**：thinking 的 token 也要计费，而且往往比正文还多
//   2. **速度**：压缩是阻塞操作，用户会等。thinking 会显著变慢
//
// 更重要的是：摘要任务**不需要推理**。它只是"把发生的事按顺序写下来"，
// 没有任何需要多步思考的推理链。
//
// 【注意这里和主路径的差异】
// 主路径（forked agent）**不能**改 thinkingConfig——因为那在缓存键里。
// 所以主路径的摘要器实际上是**带着主线程的 thinking 配置跑的**。
// 如果主线程开着 thinking，压缩请求也会 thinking，多花一笔钱。
//
// 这是一个已知的取舍：为了缓存命中，接受了 thinking 的开销。
// 从 435 行那个 98% cache miss / 380 亿 token 的数据看，
// 这笔账算得过来。
        thinkingConfig: { type: 'disabled' as const },
        tools,
        signal: context.abortController.signal,
        options: {
          async getToolPermissionContext() {
            const appState = context.getAppState()
            return appState.toolPermissionContext
          },
          model: context.options.mainLoopModel,
          toolChoice: undefined,
          isNonInteractiveSession: context.options.isNonInteractiveSession,
          hasAppendSystemPrompt: !!context.options.appendSystemPrompt,
// ═══ 备路径可以放心设 maxOutputTokens（主路径不行，见 1181 行） ═══
//
// 取 `COMPACT_MAX_OUTPUT_TOKENS` 和模型上限的较小值。
//
// 为什么要取 min？
//   —— `COMPACT_MAX_OUTPUT_TOKENS` 是"摘要需要多少输出"的经验上限
//      （几千 token，摘要不该写成长篇大论）
//   —— `getMaxOutputTokensForModel` 是模型硬上限（比如 Haiku 可能只有 8K）
//
// 如果只写前者，在输出上限较小的模型上会报错。
// 如果只写后者，在输出上限很大的模型上会允许摘要写到几万 token——
// 既慢又贵，而且超出部分通常是无意义的重复。
//
// 【`Math.min` 在这里是安全的，因为本路径不共享缓存】
// 1181 行说得很清楚：备路径可以随便设，因为它的前缀本来就
// 和主线程不同，不存在"改动导致缓存失效"的问题。
//
// 同一个文件里两条路径对同一个参数采取相反的策略，
// 是这一节最值得记住的地方。
          maxOutputTokensOverride: Math.min(
            COMPACT_MAX_OUTPUT_TOKENS,
            getMaxOutputTokensForModel(context.options.mainLoopModel),
          ),
          querySource: 'compact',
          agents: context.options.agentDefinitions.activeAgents,
          mcpTools: [],
          effortValue: appState.effortValue,
        },
      })
// ═══ 不用 `for await`，而是手动拿迭代器 ═══
//
// 写法对比：
//
//   for await (const event of streamingGen) { ... }        ← 常见写法
//   const it = streamingGen[Symbol.asyncIterator]()        ← 这里
//   let next = await it.next()
//   while (!next.done) { ...; next = await it.next() }
//
// 为什么手动？因为**需要在循环外检查"有没有拿到 response"**（1359 行）。
// `for await` 里拿到的 `event` 出了循环就没了，而这里要留一个
// `response` 变量在循环外判断。
//
// 其实用 `for await` + 外部 `let response` 也能做到……
//
// 【真正的原因是更微妙的一件事】
// 手动迭代允许**在循环中点提前退出**而不触发生成器的 `return()`。
// `for await` 里 `break` 会自动调用 `iterator.return()`，那会让
// 生成器执行 finally 块（比如 claude.ts 里的资源清理）。
//
// 这里虽然实际上没 break（一直读到 done），但保持手动模式
// 让"以后想加提前退出"变得简单。
//
// 老实说这个理由有点弱。更可能的解释是：这段代码是从别处
// 复制过来的，原处确实需要手动控制。这类"看起来没必要的手动迭代"
// 在长命代码里很常见。
      const streamIter = streamingGen[Symbol.asyncIterator]()
      let next = await streamIter.next()

      while (!next.done) {
        const event = next.value

// 第一个 text 内容块到达 → 把 UI 从"请求中"切到"响应中"。
//
// `!hasStartedStreaming` 保证只切一次。
//
// 为什么等 text 块而不是更早（比如 message_start）？
// 因为 `message_start` 到达时可能只有 thinking 块，
// 用户还看不到任何文字。等第一个 text 块到了再切状态，
// 进度条上的"正在思考"→"正在输出"才是准的。
//
// 注意这个变量的另一个用途：1367 行把它记进重试埋点。
// `hasStartedStreaming: false` 意味着"连一个字都没出就失败了"，
// 这种失败更像是网络/服务端问题；`true` 则说明"说到一半断了"。
// 两种失败的排查方向完全不同。
        if (
          !hasStartedStreaming &&
          event.type === 'stream_event' &&
          event.event.type === 'content_block_start' &&
          event.event.content_block.type === 'text'
        ) {
          hasStartedStreaming = true
          context.setStreamMode?.('responding')
        }

// 累加已流出的字符数，给 UI 显示进度用。
//
// `setResponseLength?.(length => length + charactersStreamed)`
// 传的是**函数**而不是值——因为 setState 是异步批处理的，
// 直接传 `currentLength + n` 会拿到过期的闭包值。
//
// 【为什么按字符数而不是 token 数】
// 字符数在流式过程中可以精确累加（每个 delta 都有 `.text.length`），
// 而 token 数只有在 message_delta 到达时才知道。
// UI 需要的是"感觉上的进度"，字符数够了。
//
// 注意这里用的是 `text_delta` 的 `.text.length`，
// 一个 delta 可能包含多个字符（不是逐字符到达的）。
        if (
          event.type === 'stream_event' &&
          event.event.type === 'content_block_delta' &&
          event.event.delta.type === 'text_delta'
        ) {
          const charactersStreamed = event.event.delta.text.length
          context.setResponseLength?.(length => length + charactersStreamed)
        }

// 只保留**最后一条** assistant 消息。
//
// `queryModelWithStreaming` 会 yield 多种事件：`stream_event`（每个 SSE 块）、
// `assistant`（一条完整的消息）、`result` 等。这里只关心 `assistant`。
//
// 直接赋值（不是 push 到数组），因为压缩场景**只可能有一条** assistant
// ——`maxTurns: 1` 保证了这一点。多条的话留最后一条也是合理的
// （最后一条是最完整的）。
//
// 注意 `stream_event` 只是用来驱动 UI 进度，真正的结果从 `assistant` 拿。
// 这是 `queryModelWithStreaming` 的双通道设计：yield 是流，assistant 是结果。
// 第 5 步读 `query.ts` 时讲过的"双通道 async generator"在这里的具体应用。
        if (event.type === 'assistant') {
          response = event
        }

        next = await streamIter.next()
      }

// 拿到了就立刻返回，不管 `hasStartedStreaming` 是什么状态。
//
// 【这里有一个隐含的正确性假设】
// 只要有一条 `assistant` 消息，就认为成功——**不检查它的内容是否为空**。
//
// 如果模型返回了一条空内容的 assistant 消息呢？`response` 非空，
// 这里返回它，然后调用方 `getAssistantMessageText` 返回空 →
// 走 `no_summary` 失败分支。
//
// 所以"空内容"最终也会被正确识别，只是绕了一圈。
// 这个分工挺清晰：这里判"有没有消息"，上层判"消息里有没有文本"。
      if (response) {
        return response
      }

// 没拿到 response 且还有重试机会 → 退避后重试。
//
// `getRetryDelay(attempt)` 是从 `withRetry.ts` 导进来的同一个函数
// （第 6 步第一个文件里读过）：500ms × 2^(n-1) + 正抖动，32s 封顶。
//
// 注意第三个参数：
//   `{ abortError: () => new APIUserAbortError() }`
// ——`sleep` 在信号被 abort 时要抛什么错误？这里指定抛
// `APIUserAbortError`，而不是默认的 `AbortError`。
//
// 为什么？因为上层（1205 行附近）用 `isApiErrorMessage` 判断，
// 而 `query()` 对 `APIUserAbortError` 有特殊处理（包装成合成消息）。
// 用别的错误类型会让中止变成"未知错误"，用户看到莫名其妙的失败。
//
// 【`abortError` 是函数不是实例】
// 因为每次都要 new 一个新的错误对象（错误对象带 stack trace，
// 复用会指向第一次创建的位置，排查时误导人）。
      if (attempt < maxAttempts) {
        logEvent('tengu_compact_streaming_retry', {
          attempt,
          preCompactTokenCount,
          hasStartedStreaming,
        })
        await sleep(getRetryDelay(attempt), context.abortController.signal, {
          abortError: () => new APIUserAbortError(),
        })
        continue
      }

      logForDebugging(
        `Compact streaming failed after ${attempt} attempts. hasStartedStreaming=${hasStartedStreaming}`,
        { level: 'error' },
      )
      logEvent('tengu_compact_failed', {
        reason:
          'no_streaming_response' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        preCompactTokenCount,
        hasStartedStreaming,
        retryEnabled,
        attempts: attempt,
        promptCacheSharingEnabled,
      })
      throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE)
    }

    // This should never be reached due to the throw above, but TypeScript needs it
    throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE)
// finally 只做一件事：清定时器。
//
// 但注意 1394 行的 `clearInterval(activityInterval)` —— 如果
// `activityInterval` 是 `undefined`（不在远程会话），这是空操作，安全。
//
// 【这个 finally 的位置很关键】
// 它在 `try` 块的最外层（1178 行开始），意味着**无论是成功返回、
// 抛异常、还是被中止，定时器都会被清掉**。
//
// 如果漏了这个 finally，每次压缩都会泄漏一个 30 秒间隔的定时器。
// 一个长时间运行的会话压缩 50 次，就有 50 个定时器在后台空转，
// 每秒发 50 次心跳请求——这是很典型的资源泄漏。
//
// 1391-1392 行那句 "This should never be reached" 是给 TS 的
// 控制流分析看的（for 循环理论上可能正常结束），实际到不了。
  } finally {
    clearInterval(activityInterval)
  }
}

// ═══════════════════════════════════════════════════════════════
// 压缩后的"信息重建"区（1398-1705）
//
// 从这里到文件结尾，全是 `createXxxAttachment` 系列函数。
// 它们不参与"压缩"本身，只负责回答一个问题：
//
//   **压缩丢掉了什么？补回来。**
//
// 一共七个：
//   1415  createPostCompactFileAttachments   最近读过的文件
//   1470  createPlanAttachmentIfNeeded       当前 plan 文件
//   1494  createSkillAttachmentIfNeeded      调用过的技能
//   1542  createPlanModeAttachmentIfNeeded   plan mode 状态
//   1568  createAsyncAgentAttachmentsIfNeeded 后台 agent
//   1610  collectReadToolFilePaths           （辅助）扫已读文件路径
//   1674  shouldExcludeFromPostCompactRestore（辅助）排除不该恢复的
//
// 【读这一区的正确心态】
// 不要把它们当成"附赠功能"。每一个都对应一种**真实的能力退化**，
// 而且都是在生产上踩过坑才加的。
//
// 判断一个"压缩后要补什么"的方法是问：
//   "这条信息只存在于消息历史里吗？压缩后会彻底消失吗？
//    消失之后模型会做出什么错误行为？"
// 三个问题都有答案，就该加一个 attachment。
// ═══════════════════════════════════════════════════════════════
/**
 * Creates attachment messages for recently accessed files to restore them after compaction.
 * This prevents the model from having to re-read files that were recently accessed.
 * Re-reads files using FileReadTool to get fresh content with proper validation.
 * Files are selected based on recency, but constrained by both file count and token budget limits.
 *
 * Files already present as Read tool results in preservedMessages are skipped —
 * re-injecting identical content the model can already see in the preserved tail
 * is pure waste (up to 25K tok/compact). Mirrors the diff-against-preserved
 * pattern that getDeferredToolsDeltaAttachment uses at the same call sites.
 *
 * @param readFileState The current file state tracking recently read files
 * @param toolUseContext The tool use context for calling FileReadTool
 * @param maxFiles Maximum number of files to restore (default: 5)
 * @param preservedMessages Messages kept post-compact; Read results here are skipped
 * @returns Array of attachment messages for the most recently accessed files that fit within token budget
 */
export async function createPostCompactFileAttachments(
  readFileState: Record<string, { content: string; timestamp: number }>,
  toolUseContext: ToolUseContext,
  maxFiles: number,
  preservedMessages: Message[] = [],
): Promise<AttachmentMessage[]> {
// ═══ 先算出"保留段里已经有的文件"，然后排除它们 ═══
//
// doc 注释里的关键句：
//   "Files already present as Read tool results in preservedMessages are
//    skipped — re-injecting identical content the model can already see in
//    the preserved tail is pure waste (up to 25K tok/compact)."
//
// 翻译：局部压缩保留了尾巴，而尾巴里可能就有某些文件的完整 Read 结果。
// 如果再注入一遍，最多白花 25,000 token（= 5 个文件 × 5,000）。
//
// 注意"up to 25K"这个数字——它正好是前面三个常量的乘积上限。
// 说明这个优化在最坏情况下省掉整个附件预算。
//
// `expandPath` 归一化两边路径，否则 `./a.ts` 和 `/abs/a.ts`
// 会被当成两个不同文件。
//
// 【1429 行 `!preservedReadPaths.has(...) && !shouldExclude(...)`】
// 两个条件必须都在 filter 里，不能只判一个：
//   · preservedReadPaths：已经能看见的，别重复
//   · shouldExclude：plan 文件和 CLAUDE.md，**永远**不该当"文件内容"恢复
//     （它们有自己的专用附件）
  const preservedReadPaths = collectReadToolFilePaths(preservedMessages)
  const recentFiles = Object.entries(readFileState)
    .map(([filename, state]) => ({ filename, ...state }))
    .filter(
      file =>
        !shouldExcludeFromPostCompactRestore(
          file.filename,
          toolUseContext.agentId,
        ) && !preservedReadPaths.has(expandPath(file.filename)),
    )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxFiles)

// 并发读所有候选文件。
//
// `recentFiles` 已经 `.slice(0, maxFiles)` 限制到 5 个了，
// 所以这里并发数最多 5，不会打爆文件描述符。
//
// 【注意 1440 行这个覆盖】
//   `{ ...toolUseContext, fileReadingLimits: { maxTokens: POST_COMPACT_MAX_TOKENS_PER_FILE } }`
//
// 用展开运算符**浅拷贝上下文**，然后覆盖一个字段。
// 这样 `generateFileAttachment` 拿到的上下文是正常的（权限、agentId 等都在），
// 只有读文件的 token 上限被改了。
//
// 为什么不直接改 `toolUseContext.fileReadingLimits`？
// 因为那是共享对象，改了会影响后续所有 Read 操作——用户手动 Read
// 一个文件也会被限制在 5,000 token，行为就变了。
//
// 【最后两个参数是埋点名】
// `'tengu_post_compact_file_restore_success'` / `'..._error'`
// 分开记成功和失败，可以看出"恢复文件"这个操作的健康度。
// 如果 error 率很高（比如文件被删了），说明这个机制在空转。
  const results = await Promise.all(
    recentFiles.map(async file => {
      const attachment = await generateFileAttachment(
        file.filename,
        {
          ...toolUseContext,
          fileReadingLimits: {
            maxTokens: POST_COMPACT_MAX_TOKENS_PER_FILE,
          },
        },
        'tengu_post_compact_file_restore_success',
        'tengu_post_compact_file_restore_error',
        'compact',
      )
      return attachment ? createAttachmentMessage(attachment) : null
    }),
  )

// ═══ 预算检查放在最后，而不是并发时 ═══
//
// 为什么不边读边算？因为**并发读的时候还不知道每个结果多大**。
// `Promise.all` 返回后才知道全部大小，所以只能在这之后累加。
//
// `filter` + 闭包变量 `usedTokens` 是一种"带状态的 filter"，
// 虽然有点 hack，但比 `reduce` 更易读：
//   累加后没超预算 → 留下
//   超了 → 丢弃（**并且不累加**，所以后面的小文件还有机会）
//
// 【注意这个行为：超过预算的文件被丢弃，不是截断】
// 和技能那边（1512 行 `truncateToTokens`）不同，这里直接丢。
//
// 为什么？因为文件内容**不能截断**——截断的代码文件比没有更危险
// （模型会基于残缺代码做判断，还会以为自己看全了）。
// 而技能文件截断是安全的（前面说了价值头重脚轻）。
//
// 这个对照很能说明问题：**同样的"超预算"问题，两种内容要用两种策略**。
//
// `result is AttachmentMessage` 这个类型谓词是为了让 TS 知道
// 过滤后的数组里没有 null（`generateFileAttachment` 可能返回 null，
// 比如文件不存在或太大）。
  let usedTokens = 0
  return results.filter((result): result is AttachmentMessage => {
    if (result === null) {
      return false
    }
    const attachmentTokens = roughTokenCountEstimation(jsonStringify(result))
    if (usedTokens + attachmentTokens <= POST_COMPACT_TOKEN_BUDGET) {
      usedTokens += attachmentTokens
      return true
    }
    return false
  })
}

/**
 * Creates a plan file attachment if a plan file exists for the current session.
 * This ensures the plan is preserved after compaction.
 */
// plan 文件附件。如果这个会话/agent 有 plan，就把完整内容带上。
//
// 为什么 plan 要完整带，而普通文件要截断？
// 因为 plan 是**模型自己写的执行计划**，它接下来要照着做。
// 截断一份计划比没有计划更糟——模型会以为计划只到被截断的地方。
//
// 而 plan 文件通常不大（几 KB），不构成预算压力。
//
// 【`getPlan(agentId)` 和 `getPlanFilePath(agentId)` 是两个独立查询】
// 前者查内容，后者查路径。理论上可以先查路径再读文件，
// 但那样会多一次磁盘 I/O。这里用两个内存查询，路径只是给模型
// 一个"完整文件在哪"的指针。
//
// 【plan 内容在附件里，路径也在附件里——为什么两者都要】
// 内容让模型**立刻**能继续执行（不用调工具）。
// 路径让模型**需要修改 plan 时**知道该改哪个文件。
// 缺一个都会多一轮工具调用。
export function createPlanAttachmentIfNeeded(
  agentId?: AgentId,
): AttachmentMessage | null {
  const planContent = getPlan(agentId)

  if (!planContent) {
    return null
  }

  const planFilePath = getPlanFilePath(agentId)

  return createAttachmentMessage({
    type: 'plan_file_reference',
    planFilePath,
    planContent,
  })
}

// ═══ 技能附件，这段的设计值得细看 ═══
//
// doc 注释里的两个关键约束：
//   1. "Only includes skills scoped to the given agent (or main session
//       when agentId is null/undefined)"
//      ——**按 agent 隔离**。子 agent 调用过的技能不该泄漏给主会话，
//        反之亦然。因为不同 agent 的职责完全不同，
//        把另一个 agent 的技能 guidelines 塞进来只会造成干扰。
//
//   2. "This ensures skill guidelines remain available after the conversation
//       has been summarized"
//      ——关键词是 **guidelines**。技能文件的核心价值是"规范"
//        （输出格式要求、必须检查的项、禁止的做法），
//        而不是"知识"（那些模型本来就知道）。
//
// 【为什么是"调用过的"技能，而不是"全部可用"技能】
// 全部可用 = skill_listing，约 4K token，而且会被重新推送（见 524 行）。
// 调用过的 = 真正加载过全文的那些，它们的内容已经被压缩吃掉了，
// 必须补回来。
//
// 这个区分很重要：**补的是"曾经在上下文里、现在没了"的东西**，
// 不是"未来可能需要"的东西。
/**
 * Creates an attachment for invoked skills to preserve their content across compaction.
 * Only includes skills scoped to the given agent (or main session when agentId is null/undefined).
 * This ensures skill guidelines remain available after the conversation is summarized
 * without leaking skills from other agent contexts.
 */
export function createSkillAttachmentIfNeeded(
  agentId?: string,
): AttachmentMessage | null {
  const invokedSkills = getInvokedSkillsForAgent(agentId)

  if (invokedSkills.size === 0) {
    return null
  }

// 排序 + 截断 + 预算，三步。
//
// 【排序：`b.invokedAt - a.invokedAt` = 最近的在前面】
// 注释："Sorted most-recent-first so budget pressure drops the least-relevant
// skills."
//
// 这是让**预算检查**（1517 行）自动实现优先级：filter 是从前往后走的，
// 预算用完就 return false，所以后面的（更早的）先被丢。
// 一个 `sort` 就把"丢哪个"的策略表达完了，不需要额外的权重计算。
//
// 【截断：`truncateToTokens(content, 5000)`】
// 注释："Per-skill truncation keeps the head of each file (where
// setup/usage instructions typically live) rather than dropping whole skills."
//
// 又是"砍尾巴胜过丢整体"。和 125 行那段注释说的是同一件事。
//
// 【为什么单个上限 5,000，总预算 25,000】
// 5 × 5,000 = 25,000，刚好能装 5 个技能。
// 但这不意味着"最多 5 个"——如果每个技能只有 1,000 token，
// 可以装 25 个。两个限制是独立的。
  // Sorted most-recent-first so budget pressure drops the least-relevant skills.
  // Per-skill truncation keeps the head of each file (where setup/usage
  // instructions typically live) rather than dropping whole skills.
  let usedTokens = 0
  const skills = Array.from(invokedSkills.values())
    .sort((a, b) => b.invokedAt - a.invokedAt)
    .map(skill => ({
      name: skill.skillName,
      path: skill.skillPath,
      content: truncateToTokens(
        skill.content,
        POST_COMPACT_MAX_TOKENS_PER_SKILL,
      ),
    }))
// 预算 filter，和文件那边（1453 行）结构一样，但有三个差别：
//
//   1. 这里用 `skill.content`（已经截断过的）算 token，
//      所以单个技能不会超过 5,000
//   2. 超预算的技能**跳过但继续检查后面的**（filter 的语义），
//      而不是提前 break —— 所以可能出现"第 3 个太大被跳，
//      第 4 个小被收"的情况
//   3. 返回 `false` 时不累加 `usedTokens`，所以后面的小技能还有机会
//
// 【第 2 点会导致一个奇怪的结果】
// 最终选中的技能可能**不是**"最最近的 N 个"，而是"最近的里面装得下的"。
// 这在预算紧张时会造成"跳过了一个高优先级的大技能，选了低优先级的小技能"。
//
// 是不是 bug？取决于产品意图。从 1503 行的排序注释看，
// 作者想要的是"预算压力时丢最不相关的"。而现在的实现是
// "装不下就跳，继续找装得下的"——这其实更合理：
// 一个 4,900 token 的最近技能 vs 三个 1,000 token 的次近技能，
// 后者信息量更大。
    .filter(skill => {
      const tokens = roughTokenCountEstimation(skill.content)
      if (usedTokens + tokens > POST_COMPACT_SKILLS_TOKEN_BUDGET) {
        return false
      }
      usedTokens += tokens
      return true
    })

  if (skills.length === 0) {
    return null
  }

  return createAttachmentMessage({
    type: 'invoked_skills',
    skills,
  })
}

// plan mode 附件。
//
// doc 注释揭示了一个容易忽略的机制：
//   "otherwise it would lose the plan mode instructions since those are
//    normally only injected on tool-use turns via getAttachmentMessages"
//
// 翻译：plan mode 的指令**不是每轮都发**，而是只在"有工具调用的轮次"
// 通过 `getAttachmentMessages` 注入。
//
// 为什么这样设计？因为 plan mode 的指令很长（"你现在只能做只读操作，
// 输出一份方案，不要改代码…"），每轮都发纯属浪费。
// 而只在要调工具时提醒，是最有效的时机。
//
// 但压缩之后，历史里那些"tool-use 轮次注入的 plan mode 指令"
// 全被摘要吃掉了。摘要里可能写着"用户要求先出方案"，
// 但那不是**可执行的指令**——模型会开始直接改代码。
//
// 所以必须补一个 `reminderType: 'full'` 的完整版（不是简版）。
//
// 【`isSubAgent: !!context.agentId`】
// 主会话和子 agent 的 plan mode 行为不同（子 agent 可能不允许进 plan 模式），
// 所以附件里要标明身份。`!!` 把 `AgentId | undefined` 转成 boolean。
/**
 * Creates a plan_mode attachment if the user is currently in plan mode.
 * This ensures the model continues to operate in plan mode after compaction
 * (otherwise it would lose the plan mode instructions since those are
 * normally only injected on tool-use turns via getAttachmentMessages).
 */
export async function createPlanModeAttachmentIfNeeded(
  context: ToolUseContext,
): Promise<AttachmentMessage | null> {
  const appState = context.getAppState()
  if (appState.toolPermissionContext.mode !== 'plan') {
    return null
  }

  const planFilePath = getPlanFilePath(context.agentId)
  const planExists = getPlan(context.agentId) !== null

  return createAttachmentMessage({
    type: 'plan_mode',
    reminderType: 'full',
    isSubAgent: !!context.agentId,
    planFilePath,
    planExists,
  })
}

// 后台 agent 附件。两种状态都要带：
//   · `running`   —— 还在跑（不告诉模型，它会重复 spawn 同一个任务）
//   · 已完成但没取结果 —— 不告诉模型，它不会去取，结果白算
//
// 注释："Covers both agents still running in the background (so the model
// doesn't spawn a duplicate) and agents that have finished but whose results
// haven't been retrieved yet."
//
// 【这两个场景的后果不对称】
//   · 重复 spawn：浪费一次完整执行（可能几分钟 + 大量 token）
//   · 忘记取结果：浪费一次完整执行，**而且用户拿不到结果**
//
// 后者更糟。所以即使 agent 已经完成，只要 `retrieved === false` 就要带上。
/**
 * Creates attachments for async agents so the model knows about them after
 * compaction. Covers both agents still running in the background (so the model
 * doesn't spawn a duplicate) and agents that have finished but whose results
 * haven't been retrieved yet.
 */
export async function createAsyncAgentAttachmentsIfNeeded(
  context: ToolUseContext,
): Promise<AttachmentMessage[]> {
  const appState = context.getAppState()
  const asyncAgents = Object.values(appState.tasks).filter(
    (task): task is LocalAgentTaskState => task.type === 'local_agent',
  )

  return asyncAgents.flatMap(agent => {
// 三个跳过条件，各有理由：
//
//   `agent.retrieved`        —— 结果已经被取走了，模型知道了，不用再提
//   `agent.status === 'pending'` —— 还没真正启动，没有可报告的状态
//   `agent.agentId === context.agentId` —— **自己**。压缩 agent 自己
//                               在 `appState.tasks` 里也是一条记录，
//                               报告"我自己在跑"毫无意义
//
// 【第三个条件最容易漏】
// 如果不排除自己，压缩后的上下文里会出现"有个叫 compact 的 agent
// 正在运行"——模型会以为有个后台任务，可能会去等它或者查它。
// 而那个 agent 其实就是刚刚做完压缩的这个。
//
// 【`deltaSummary` 的取值逻辑也值得看】
//   running → `agent.progress?.summary`（进度摘要）
//   否则    → `agent.error`（错误信息）
//
// 也就是说"失败的 agent 会带上错误原因"。这样模型看到后
// 能判断"该重试还是该换方案"，而不是只知道"失败了"。
//
// `outputFilePath` 是结果文件路径（`getTaskOutputPath`）。
// 即使 `retrieved: false`，模型也能自己去读那个文件——
// 这个设计比"直接把结果塞进附件"省 token。
    if (
      agent.retrieved ||
      agent.status === 'pending' ||
      agent.agentId === context.agentId
    ) {
      return []
    }
    return [
      createAttachmentMessage({
        type: 'task_status',
        taskId: agent.agentId,
        taskType: 'local_agent',
        description: agent.description,
        status: agent.status,
        deltaSummary:
          agent.status === 'running'
            ? (agent.progress?.summary ?? null)
            : (agent.error ?? null),
        outputFilePath: getTaskOutputPath(agent.agentId),
      }),
    ]
  })
}

// ═══ 扫已读文件路径，用来去重 ═══
//
// 这个函数要扫两遍消息，但不是为了性能——是因为**必须先知道
// 哪些 tool_use_id 是"桩"，才能正确地收集路径**。
//
// 第一遍（1611-1625）：收集所有"返回了 FILE_UNCHANGED_STUB 的 tool_use_id"
// 第二遍（1627-1653）：收集文件路径，但跳过那些桩对应的 tool_use
//
// 【为什么要跳过桩？doc 注释说得很清楚】
//   "the stub points at an earlier full Read that may have been compacted away,
//    so we want createPostCompactFileAttachments to re-inject the real content."
//
// 场景还原：
//   1. 模型 Read a.ts（完整内容，5,000 token）
//   2. 模型又 Read a.ts（内容没变，返回 "file unchanged" 桩）
//   3. 压缩发生，两步的历史都被摘要吃掉
//   4. 如果只看"最后一条 Read 记录"，会看到桩 → 认为"这个文件已经在上下文里了"
//      → **不恢复**
//   5. 模型以为 a.ts 内容还在，实际上早没了
//
// 所以桩不能算"已读"。必须回溯到最早那次真正的 Read——
// 而最简单的方法就是**不认桩**，让这个文件重新进候选。
//
// 【`FILE_UNCHANGED_STUB` 这个常量是同目录 prompt.ts 导出的】
// 用共享常量而不是硬编码字符串，保证"生桩"和"认桩"两边永远一致。
/**
 * Scan messages for Read tool_use blocks and collect their file_path inputs
 * (normalized via expandPath). Used to dedup post-compact file restoration
 * against what's already visible in the preserved tail.
 *
 * Skips Reads whose tool_result is a dedup stub — the stub points at an
 * earlier full Read that may have been compacted away, so we want
 * createPostCompactFileAttachments to re-inject the real content.
 */
function collectReadToolFilePaths(messages: Message[]): Set<string> {
  const stubIds = new Set<string>()
  for (const message of messages) {
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      continue
    }
    for (const block of message.message.content) {
      if (
        block.type === 'tool_result' &&
        typeof block.content === 'string' &&
        block.content.startsWith(FILE_UNCHANGED_STUB)
      ) {
        stubIds.add(block.tool_use_id)
      }
    }
  }

  const paths = new Set<string>()
  for (const message of messages) {
    if (
      message.type !== 'assistant' ||
      !Array.isArray(message.message.content)
    ) {
      continue
    }
    for (const block of message.message.content) {
      if (
        block.type !== 'tool_use' ||
        block.name !== FILE_READ_TOOL_NAME ||
        stubIds.has(block.id)
      ) {
        continue
      }
      const input = block.input
      if (
        input &&
        typeof input === 'object' &&
        'file_path' in input &&
        typeof input.file_path === 'string'
      ) {
        paths.add(expandPath(input.file_path))
      }
    }
  }
  return paths
}

// 截断标记，追加在技能内容末尾。
//
// 文本是：
//   "\n\n[... skill content truncated for compaction; use Read on the skill
//    path if you need the full text]"
//
// 【这句话是写给模型看的，不是给人看的】
// 它同时完成了三件事：
//   1. 明确说"这里截断了"——避免模型以为技能就到这儿
//   2. 说明**原因**（"for compaction"）——让模型理解这不是技能本身残缺
//   3. 给出**补救方法**（"use Read on the skill path"）——模型知道怎么办
//
// 这是"截断标记"的范本写法。对比一下常见的坏例子：
//   `"..."`                    ← 模型不知道发生了什么
//   `"[truncated]"`            ← 知道被截了，但不知道怎么办
//   `"[content omitted]"`      ← 更糟，模型会以为内容被故意保密
//
// 【前面的 `\n\n`】
// 两个换行，保证标记独占一个段落。如果紧贴正文，
// markdown 渲染时可能并进上一行，看起来像是技能内容的一部分。
const SKILL_TRUNCATION_MARKER =
  '\n\n[... skill content truncated for compaction; use Read on the skill path if you need the full text]'

// 按 token 数截断，保守估计。
//
// doc 注释把算法说得很清楚：
//   "roughTokenCountEstimation uses ~4 chars/token (its default bytesPerToken),
//    so char budget = maxTokens * 4 minus the marker so the result stays
//    within budget."
//
// 也就是：`charBudget = maxTokens * 4 - marker.length`
//
// 【为什么要减去 marker 的长度】
// 如果不减，`slice(0, maxTokens*4) + marker` 的总长度就超过了
// `maxTokens*4` → 实际 token 数超过 `maxTokens` → 后面的预算检查
// 会把它算得更大，可能导致"明明设了 5,000 上限，实际占了 5,050"。
//
// 这是个很小的细节，但正是这类"差之毫厘"导致了
// "为什么实际 token 数总是超预算一点点"的经典困惑。
//
// 【1670 行没有判 `charBudget < 0`】
// 如果 `maxTokens` 很小（比如 10），`10*4 - 100 = -60`，
// `slice(0, -60)` 会从末尾倒数——返回一个很奇怪的结果。
//
// 但实际调用点（1512 行）传的是 `POST_COMPACT_MAX_TOKENS_PER_SKILL = 5000`，
// 不可能这么小。这是"调用点保证了参数范围，所以函数内不防御"的写法。
// 在内部函数里这种省略很常见，但对外暴露的 API 不该这么写。
/**
 * Truncate content to roughly maxTokens, keeping the head. roughTokenCountEstimation
 * uses ~4 chars/token (its default bytesPerToken), so char budget = maxTokens * 4
 * minus the marker so the result stays within budget. Marker tells the model it
 * can Read the full file if needed.
 */
function truncateToTokens(content: string, maxTokens: number): string {
  if (roughTokenCountEstimation(content) <= maxTokens) {
    return content
  }
  const charBudget = maxTokens * 4 - SKILL_TRUNCATION_MARKER.length
  return content.slice(0, charBudget) + SKILL_TRUNCATION_MARKER
}

// 排除两类文件，不让它们当"普通文件"恢复：
//
//   1. **plan 文件** —— 它有专用附件（1470 行 `createPlanAttachmentIfNeeded`），
//      那里带的是完整内容 + 路径，比"当普通文件恢复"信息更全。
//      两个都恢复就是重复占预算。
//
//   2. **所有 claude.md 类型的内存文件** —— 它们有专用的加载机制
//      （`loadedNestedMemoryPaths`，520 行刚清空过）。
//      如果当成普通文件恢复，会出现两份 CLAUDE.md 内容，
//      而且可能是不同层级的（项目级 + 用户级 + 子目录级），模型会混乱。
//
// 【两个 try/catch 都是空的（只有注释）】
// 为什么？因为这些函数（`getPlanFilePath`、`getMemoryPath`）
// 在某些环境下会抛（比如拿不到 home 目录）。
// 抛了不能让整个附件生成失败——"排除逻辑"失败的最坏后果是
// "多恢复了一个文件"，远好过"压缩后什么都没恢复"。
//
// 这是一个**降级方向明确**的设计：宁可多恢复，不可不恢复。
//
// 【1690 行那个 TODO 值得注意】
//   "TODO: Refactor to use isMemoryFilePath() from claudemd.ts for consistency
//    and to also match child directory memory files (.claude/rules/*.md, etc.)"
//
// 翻译：现在的实现只匹配"顶层几个固定的内存文件路径"，
// **漏掉了子目录的规则文件**（`.claude/rules/*.md`、子目录里的 CLAUDE.md）。
//
// 这是一个已知的不完整实现。后果：如果用户的项目里有
// 子目录 CLAUDE.md，压缩后可能被当成普通文件重复恢复一份。
// 影响不大（浪费点 token），所以一直没修。
function shouldExcludeFromPostCompactRestore(
  filename: string,
  agentId?: AgentId,
): boolean {
  const normalizedFilename = expandPath(filename)
  // Exclude plan files
  try {
    const planFilePath = expandPath(getPlanFilePath(agentId))
    if (normalizedFilename === planFilePath) {
      return true
    }
  } catch {
    // If we can't get plan file path, continue with other checks
  }

  // Exclude all types of claude.md files
  // TODO: Refactor to use isMemoryFilePath() from claudemd.ts for consistency
  // and to also match child directory memory files (.claude/rules/*.md, etc.)
  try {
    const normalizedMemoryPaths = new Set(
      MEMORY_TYPE_VALUES.map(type => expandPath(getMemoryPath(type))),
    )

    if (normalizedMemoryPaths.has(normalizedFilename)) {
      return true
    }
  } catch {
    // If we can't get memory paths, continue
  }

  return false
}
