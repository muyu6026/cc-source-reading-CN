// 本文件是「清缓存」的总闸：把二十几个模块里攒下的内存缓存逐个清掉，让下一次读到的都是新鲜的。
//
// 顶部注释点出了它的特殊性：**本模块在启动时就被 main.tsx 导入**，所以 import 必须保持极简。这是「清缓存」这件事的反讽——一个专门用来清理的东西，自己却在启动路径上，于是它不能依赖任何重模块。
//
// 读这个文件的正确姿势：不要试图记住每一项，而是看**它清了几类东西**（上下文/命令/提示词注入/技能/会话指针/图片/仓库探测），以及**哪几项在特定条件下故意不清**。
/**
 * Session cache clearing utilities.
 * This module is imported at startup by main.tsx, so keep imports minimal.
 */
import { feature } from 'bun:bundle'
import {
  clearInvokedSkills,
  setLastEmittedDate,
} from '../../bootstrap/state.js'
import { clearCommandsCache } from '../../commands.js'
import { getSessionStartDate } from '../../constants/common.js'
import {
  getGitStatus,
  getSystemContext,
  getUserContext,
  setSystemPromptInjection,
} from '../../context.js'
import { clearFileSuggestionCaches } from '../../hooks/fileSuggestions.js'
import { clearAllPendingCallbacks } from '../../hooks/useSwarmPermissionPoller.js'
import { clearAllDumpState } from '../../services/api/dumpPrompts.js'
import { resetPromptCacheBreakDetection } from '../../services/api/promptCacheBreakDetection.js'
import { clearAllSessions } from '../../services/api/sessionIngress.js'
import { runPostCompactCleanup } from '../../services/compact/postCompactCleanup.js'
import { resetAllLSPDiagnosticState } from '../../services/lsp/LSPDiagnosticRegistry.js'
import { clearTrackedMagicDocs } from '../../services/MagicDocs/magicDocs.js'
import { clearDynamicSkills } from '../../skills/loadSkillsDir.js'
import { resetSentSkillNames } from '../../utils/attachments.js'
import { clearCommandPrefixCaches } from '../../utils/bash/commands.js'
import { resetGetMemoryFilesCache } from '../../utils/claudemd.js'
import { clearRepositoryCaches } from '../../utils/detectRepository.js'
import { clearResolveGitDirCache } from '../../utils/git/gitFilesystem.js'
import { clearStoredImagePaths } from '../../utils/imageStore.js'
import { clearSessionEnvVars } from '../../utils/sessionEnvVars.js'

/**
 * Clear all session-related caches.
 * Call this when resuming a session to ensure fresh file/skill discovery.
 * This is a subset of what clearConversation does - it only clears caches
 * without affecting messages, session ID, or triggering hooks.
 *
 * @param preservedAgentIds - Agent IDs whose per-agent state should survive
 *   the clear (e.g., background tasks preserved across /clear). When non-empty,
 *   agentId-keyed state (invoked skills) is selectively cleared and requestId-keyed
 *   state (pending permission callbacks, dump state, cache-break tracking) is left
 *   intact since it cannot be safely scoped to the main session.
 */
// `clearSessionCaches` 是唯一导出。
//
// 注意上面的 JSDoc 已经说清定位：它是 `clearConversation` 的**子集**——只清缓存，不动消息、不换会话 ID、不触发钩子。所以「恢复会话」也能调它，而 `/clear` 调的是完整版（本函数 + 消息清空 + 换 ID + 钩子）。
//
// 参数 `preservedAgentIds` 是「要保命的 agent」：后台任务在 /clear 之后还要继续跑，它们的 per-agent 状态不能被抹掉。
export function clearSessionCaches(
  preservedAgentIds: ReadonlySet<string> = new Set(),
): void {
  const hasPreserved = preservedAgentIds.size > 0
// 先算出「有没有需要保留的 agent」这一个布尔量，下面多处要用它做分支。
//
// 写成局部变量而不是每次调用 `preservedAgentIds.size > 0`，是为了让后面四个 `if (!hasPreserved)` 读起来是同一个判断，而不是四次重复计算。
  // Clear context caches
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
  getGitStatus.cache.clear?.()
  getSessionStartDate.cache.clear?.()
// 第一组：四个「记忆化函数的缓存」。
//
// `getUserContext.cache.clear?.()` 这个写法值得注意——`cache` 是挂在函数对象上的属性，`?.()` 表示「这个函数上可能没有 cache，没有就跳过」。这四个都是「算一次很贵、结果会被缓存」的上下文获取函数（用户上下文、系统上下文、git 状态、会话开始日期），/clear 之后必须重算。
  // Clear file suggestion caches (for @ mentions)
  clearFileSuggestionCaches()
// 清掉文件补全缓存：`@` 提及文件时的那份候选列表。
//
// 为什么要和上面分开写：它不是一个记忆化函数的属性，而是一个模块级函数，所以没有 `.cache.clear?.()` 那套写法。

  // Clear commands/skills cache
  clearCommandsCache()
// 清命令与技能缓存：斜杠命令清单、技能清单。
//
// 这两类都是「从磁盘扫描出来的」，/clear 后要重新扫——因为用户可能刚装了新技能、刚改了 .claude 目录。

  // Clear prompt cache break detection state
  if (!hasPreserved) resetPromptCacheBreakDetection()
// 清「提示词缓存断裂检测」的状态。
//
// **`if (!hasPreserved)` 这个条件是本文件第一个关键设计**：如果有后台 agent 要保留，这项状态就不能清——它按 requestId 记账，清掉之后那些 agent 的缓存断裂追踪会失去历史，统计口径就乱了。注释里说得直白：这类状态**无法安全地限定到主会话**，所以只能整体保留。

  // Clear system prompt injection (cache breaker)
  setSystemPromptInjection(null)
// 清掉系统提示词注入并置空。
//
// 这行注释写着 cache breaker——注入内容的**存在本身**就是一个缓存断点：系统提示词变了，之前缓存的整个前缀全废。所以清掉它不只是清数据，是在「解除一个会让缓存失效的状态」。

  // Clear last emitted date so it's re-detected on next turn
  setLastEmittedDate(null)
// 把「上次发出的日期」置空，下一轮会重新探测。
//
// 日期进了系统提示词，跨午夜时如果不更新，模型会以为还是昨天。这里置空 = 下一轮重新读当前日期。

  // Run post-compaction cleanup (clears system prompt sections, microcompact tracking,
  // classifier approvals, speculative checks, and — for main-thread compacts — memory
  // files cache with load_reason 'compact').
  runPostCompactCleanup()
// 复用压缩流程的清理逻辑。
//
// `runPostCompactCleanup` 原本是「上下文压缩完之后」跑的清理（清系统提示词分段、微压缩记账、分类器批准记录、推测性检查等）。这里直接借用——因为「压缩完」和「清空会话」在「该清哪些缓存」上高度重合。
  // Reset sent skill names so the skill listing is re-sent after /clear.
  // runPostCompactCleanup intentionally does NOT reset this (post-compact
  // re-injection costs ~4K tokens), but /clear wipes messages entirely so
  // the model needs the full listing again.
// 重置「已发送的技能名」清单。
//
// 上面注释解释了一个反直觉的决定：`runPostCompactCleanup` **故意不**重置这个，因为压缩后重新注入技能清单要花约 4K token，能省则省。但 `/clear` 把消息全清空了，模型手里什么都没有，只能重新完整发一遍清单——不然它不知道自己有哪些技能可用。
//
// **同一份清理逻辑，在两种场景下的正确答案相反**，这就是不能简单复用的原因。
  resetSentSkillNames()
  // Override the memory cache reset with 'session_start': clearSessionCaches is called
  // from /clear and --resume/--continue, which are NOT compaction events. Without this,
  // the InstructionsLoaded hook would fire with load_reason 'compact' instead of
  // 'session_start' on the next getMemoryFiles() call.
  resetGetMemoryFilesCache('session_start')
// **这里有一个很容易漏的坑，注释写了整整五行。**
//
// `runPostCompactCleanup` 内部会重置记忆文件缓存，但会把重置原因标成 `compact`（压缩）。可 `/clear` 和 `--resume` 都不是压缩事件——如果不覆盖这个原因，下一轮 `getMemoryFiles()` 时 `InstructionsLoaded` 钩子收到的 `load_reason` 会是错的，所有依赖这个字段做判断的钩子都会走错分支。
//
// 所以这行必须**显式**用 `session_start` 再重置一次，覆盖掉刚才那次的标记。这是「复用别人的清理函数」时典型要付的代价：它顺带做的事，你必须纠正。

  // Clear stored image paths cache
  clearStoredImagePaths()
// 清掉「已存图片路径」的缓存。
//
// 图片是单独存在磁盘上的，对话里只放路径引用。清会话后这些引用没人指向了，缓存也该跟着清。

  // Clear all session ingress caches (lastUuidMap, sequentialAppendBySession)
  clearAllSessions()
// 清会话写入（session ingress）的所有缓存：`lastUuidMap`、`sequentialAppendBySession`。
//
// 这两个名字透露了机制：会话转录是**追加写**的，需要记住「每个会话最后写到哪个 UUID」才能续上。 /clear 之后是全新会话，旧指针必须作废，否则新会话的第一条会接在旧会话末尾。
  // Clear swarm permission pending callbacks
  if (!hasPreserved) clearAllPendingCallbacks()
// 清 swarm 的待处理权限回调。
//
// 同样受 `hasPreserved` 保护：后台 agent 可能正等着某个权限回调返回，清掉它等于让那个 agent 永远等下去。

  // Clear tungsten session usage tracking
  if (process.env.USER_TYPE === 'ant') {
    void import('../../tools/TungstenTool/TungstenTool.js').then(
      ({ clearSessionsWithTungstenUsage, resetInitializationState }) => {
        clearSessionsWithTungstenUsage()
        resetInitializationState()
      },
    )
  }
// 只有 Anthropic 内部员工（`USER_TYPE === 'ant'`）才会走到这里：清 Tungsten 工具的使用统计。
//
// 注意 `void import(...)` 这个写法：**用动态导入，而且不等它完成**。原因有二——一是内部工具不该出现在普通用户的启动路径上（死代码消除要能删掉它），二是清理统计这种事不该阻塞 /clear 的返回。
  // Clear attribution caches (file content cache, pending bash states)
  // Dynamic import to preserve dead code elimination for COMMIT_ATTRIBUTION feature flag
  if (feature('COMMIT_ATTRIBUTION')) {
    void import('../../utils/attributionHooks.js').then(
      ({ clearAttributionCaches }) => clearAttributionCaches(),
    )
  }
// 清「提交归属」缓存，同样用动态导入 + 不等。
//
// 注释给了理由：`COMMIT_ATTRIBUTION` 是构建期开关，写死动态导入才能让打包工具在开关关闭时把这整段删掉。这是本仓库最常见的「为打包服务」的写法。
  // Clear repository detection caches
  clearRepositoryCaches()
  // Clear bash command prefix caches (Haiku-extracted prefixes)
  clearCommandPrefixCaches()
  // Clear dump prompts state
  if (!hasPreserved) clearAllDumpState()
  // Clear invoked skills cache (each entry holds full skill file content)
  clearInvokedSkills(preservedAgentIds)
// 清「已调用技能」缓存。
//
// 这一项在注释里写明：**每条记录都存着完整的技能文件内容**，所以不清的话内存会随技能调用一路涨。
//
// 它把 `preservedAgentIds` 传下去，实现「只清主会话的、保留后台 agent 的」——这是分层清理的典型样本：一个函数，两种粒度。
  // Clear git dir resolution cache
  clearResolveGitDirCache()
  // Clear dynamic skills (loaded from skill directories)
  clearDynamicSkills()
  // Clear LSP diagnostic tracking state
  resetAllLSPDiagnosticState()
  // Clear tracked magic docs
  clearTrackedMagicDocs()
  // Clear session environment variables
  clearSessionEnvVars()
// 清会话环境变量。
//
// 到这里「明确属于会话」的东西都清完了。下面四段全是动态导入的「边角缓存」，共同原因是：它们各自属于某个工具，而工具模块不该为了清缓存就被拉进启动路径。
  // Clear WebFetch URL cache (up to 50MB of cached page content)
  void import('../../tools/WebFetchTool/utils.js').then(
    ({ clearWebFetchCache }) => clearWebFetchCache(),
  )
// 清 WebFetch 的网页内容缓存。注释标了量级：最多 50MB。
//
// 这个数字说明为什么必须清——不清的话，一次长会话可能一直占着几十兆的已抓网页。
  // Clear ToolSearch description cache (full tool prompts, ~500KB for 50 MCP tools)
  void import('../../tools/ToolSearchTool/ToolSearchTool.js').then(
    ({ clearToolSearchDescriptionCache }) => clearToolSearchDescriptionCache(),
  )
// 清 ToolSearch 的工具描述缓存。注释同样标了量级：50 个 MCP 工具约 500KB。
//
// 和上一条同一个模式：**缓存大的地方，都要在会话边界上清一次**。
  // Clear agent definitions cache (accumulates per-cwd via EnterWorktreeTool)
  void import('../../tools/AgentTool/loadAgentsDir.js').then(
    ({ clearAgentDefinitionsCache }) => clearAgentDefinitionsCache(),
  )
// 清 agent 定义缓存。
//
// 注释点出了它为什么会「按目录累积」：`EnterWorktreeTool` 换工作目录时会重新扫描 agent 定义，每个新的 cwd 都留一份，于是越积越多。
  // Clear SkillTool prompt cache (accumulates per project root)
  void import('../../tools/SkillTool/prompt.js').then(({ clearPromptCache }) =>
    clearPromptCache(),
  )
// 最后一项：SkillTool 的提示词缓存（按项目根目录累积）。
//
// 到这里可以回头数一下：本函数清了 **七类**东西——记忆化上下文、文件补全、命令与技能、提示词相关状态、会话写入指针、按 agent 保留的状态、以及各工具的大块缓存。读完后你应该能回答：为什么这个文件必须在启动路径上（因为 `/clear` 可能在任何时刻被敲下，而它要清的模块遍布全仓，只能由它自己反向依赖所有模块）。
}
