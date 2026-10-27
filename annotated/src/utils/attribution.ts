import { feature } from 'bun:bundle'
import { stat } from 'fs/promises'
import { getClientType } from '../bootstrap/state.js'
import {
  getRemoteSessionUrl,
  isRemoteSessionLocal,
  PRODUCT_URL,
} from '../constants/product.js'
import { TERMINAL_OUTPUT_TAGS } from '../constants/xml.js'
import type { AppState } from '../state/AppState.js'
import { FILE_EDIT_TOOL_NAME } from '../tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../tools/GrepTool/prompt.js'
import type { Entry } from '../types/logs.js'
import {
  type AttributionData,
  calculateCommitAttribution,
  isInternalModelRepo,
  isInternalModelRepoCached,
  sanitizeModelName,
} from './commitAttribution.js'
import { logForDebugging } from './debug.js'
import { parseJSONL } from './json.js'
import { logError } from './log.js'
import {
  getCanonicalName,
  getMainLoopModel,
  getPublicModelDisplayName,
  getPublicModelName,
} from './model/model.js'
import { isMemoryFileAccess } from './sessionFileAccessHooks.js'
import { getTranscriptPath } from './sessionStorage.js'
import { readTranscriptForLoad } from './sessionStoragePortable.js'
import { getInitialSettings } from './settings/settings.js'
import { isUndercover } from './undercover.js'

export type AttributionTexts = {
  commit: string
  pr: string
}
// 定义 `AttributionTexts` 类型，仅含 `commit` 与 `pr` 两个字段，分别对应提交信息与 PR 描述里要插入的署名文本。

/**
 * Returns attribution text for commits and PRs based on user settings.
 * Handles:
 * - Dynamic model name via getPublicModelName()
 * - Custom attribution settings (settings.attribution.commit/pr)
 * - Backward compatibility with deprecated includeCoAuthoredBy setting
 * - Remote mode: returns session URL for attribution
 */
export function getAttributionTexts(): AttributionTexts {
// 根据设置返回提交与 PR 的署名文本：内部仓库用真实模型名，远程会话直接回会话链接，否则回退到默认署名。
  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
// 隐蔽模式（内部蚂蚁环境且处于 undercover）下返回空署名，避免暴露内部身份与代号。
    return { commit: '', pr: '' }
  }

  if (getClientType() === 'remote') {
// 远程客户端分支：优先用会话入口链接作为署名；本地开发会话链接无法持久化，故跳过。
    const remoteSessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    if (remoteSessionId) {
      const ingressUrl = process.env.SESSION_INGRESS_URL
      // Skip for local dev - URLs won't persist
      if (!isRemoteSessionLocal(remoteSessionId, ingressUrl)) {
        const sessionUrl = getRemoteSessionUrl(remoteSessionId, ingressUrl)
        return { commit: sessionUrl, pr: sessionUrl }
      }
    }
    return { commit: '', pr: '' }
  }

  // @[MODEL LAUNCH]: Update the hardcoded fallback model name below (guards against codename leaks).
  // For internal repos, use the real model name. For external repos,
  // fall back to "Claude Opus 4.6" for unrecognized models to avoid leaking codenames.
// 模型发射标记注释：下方硬编码的兜底模型名（line 78）用于在无法识别时防止内部代号外泄。
  const model = getMainLoopModel()
// 取主循环模型，结合是否已知公开模型或内部仓库，决定使用公开名还是兜底为 Claude Opus 4.6。
  const isKnownPublicModel = getPublicModelDisplayName(model) !== null
  const modelName =
    isInternalModelRepoCached() || isKnownPublicModel
      ? getPublicModelName(model)
      : 'Claude Opus 4.6'
// 三目运算拼出最终模型名；内部仓库或已知公开模型用 `getPublicModelName`，未知外部模型统一兜底。
  const defaultAttribution = `🤖 Generated with [Claude Code](${PRODUCT_URL})`
// 默认署名模板：一条带产品链接的生成说明，以及 Co-Authored-By 提交尾注。
  const defaultCommit = `Co-Authored-By: ${modelName} <noreply@anthropic.com>`

  const settings = getInitialSettings()
// 读取初始设置，决定走用户自定义署名还是默认署名。

  // New attribution setting takes precedence over deprecated includeCoAuthoredBy
  if (settings.attribution) {
    return {
      commit: settings.attribution.commit ?? defaultCommit,
      pr: settings.attribution.pr ?? defaultAttribution,
    }
  }
// 新版 `attribution` 设置优先于已废弃的 `includeCoAuthoredBy`：有自定义则直接返回。

  // Backward compatibility: deprecated includeCoAuthoredBy setting
  if (settings.includeCoAuthoredBy === false) {
    return { commit: '', pr: '' }
  }
// 向后兼容：显式关闭 `includeCoAuthoredBy` 时返回空署名。

  return { commit: defaultCommit, pr: defaultAttribution }
// 以上条件都不满足时，返回默认提交与 PR 署名。
}

/**
 * Check if a message content string is terminal output rather than a user prompt.
 * Terminal output includes bash input/output tags and caveat messages about local commands.
 */
function isTerminalOutput(content: string): boolean {
// 判断消息内容是否为终端输出（含 bash 输入/输出标签或本地命令提示），而非用户真实输入。
  for (const tag of TERMINAL_OUTPUT_TAGS) {
    if (content.includes(`<${tag}>`)) {
      return true
    }
  }
  return false
}
// 遍历 `TERMINAL_OUTPUT_TAGS`，命中任一标签即判定为终端输出并返回真。

/**
 * Count user messages with visible text content in a list of non-sidechain messages.
 * Excludes tool_result blocks, terminal output, and empty messages.
 *
 * Callers should pass messages already filtered to exclude sidechain messages.
 */
export function countUserPromptsInMessages(
  messages: ReadonlyArray<{ type: string; message?: { content?: unknown } }>,
): number {
// 统计一批非旁路消息中带可见文本的用户消息数量，供后续计算 steers 数。
  let count = 0

  for (const message of messages) {
// 只处理 `type` 为 `user` 的消息，其余直接跳过。
    if (message.type !== 'user') {
      continue
    }

    const content = message.message?.content
// 取出消息内容，缺失则跳过该条。
    if (!content) {
      continue
    }

    let hasUserText = false

    if (typeof content === 'string') {
      if (isTerminalOutput(content)) {
        continue
      }
      hasUserText = content.trim().length > 0
    } else if (Array.isArray(content)) {
// 数组内容逐区块判断：文本且非终端输出、图片或文档均算有效用户文本。
      hasUserText = content.some(block => {
        if (!block || typeof block !== 'object' || !('type' in block)) {
          return false
        }
        return (
          (block.type === 'text' &&
            typeof block.text === 'string' &&
            !isTerminalOutput(block.text)) ||
          block.type === 'image' ||
          block.type === 'document'
        )
      })
    }
// 结束对单条消息内容的判定，把结果并入 `hasUserText`。

    if (hasUserText) {
      count++
    }
  }

  return count
// 无更多有效文本时返回累计计数。
}

/**
 * Count non-sidechain user messages in transcript entries.
 * Used to calculate the number of "steers" (user prompts - 1).
 *
 * Counts user messages that contain actual user-typed text,
 * excluding tool_result blocks, sidechain messages, and terminal output.
 */
function countUserPromptsFromEntries(entries: ReadonlyArray<Entry>): number {
// 从转录条目统计用户提示数：先过滤掉旁路消息再交给上面的计数函数。
  const nonSidechain = entries.filter(
    entry =>
      entry.type === 'user' && !('isSidechain' in entry && entry.isSidechain),
  )
  return countUserPromptsInMessages(nonSidechain)
// 用 `filter` 剔除 `isSidechain` 消息，再复用 `countUserPromptsInMessages` 完成计数。
}

/**
 * Get full attribution data from the provided AppState's attribution state.
 * Uses ALL tracked files from the attribution state (not just staged files)
 * because for PR attribution, files may not be staged yet.
 * Returns null if no attribution data is available.
 */
async function getPRAttributionData(
  appState: AppState,
): Promise<AttributionData | null> {
// 异步获取 PR 署名数据：用归因状态里所有被追踪文件（含未暂存）计算提交归因。
  const attribution = appState.attribution

  if (!attribution) {
// 无归因状态时直接返回 null，避免无效计算。
    return null
  }

  // Handle both Map and plain object (in case of serialization)
// 兼容 `Map` 与普通对象两种存储形态（序列化后可能是对象）。
  const fileStates = attribution.fileStates
  const isMap = fileStates instanceof Map
  const trackedFiles = isMap
    ? Array.from(fileStates.keys())
    : Object.keys(fileStates)
// 根据是否为 Map 取出被追踪文件键集合，空集合直接返回 null。

  if (trackedFiles.length === 0) {
    return null
  }

  try {
    return await calculateCommitAttribution([attribution], trackedFiles)
// 尝试计算提交归因，出错则记录日志并返回 null 而非抛异常。
  } catch (error) {
    logError(error as Error)
    return null
  }
}

const MEMORY_ACCESS_TOOL_NAMES = new Set([
  FILE_READ_TOOL_NAME,
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
])
// 定义会触发记忆文件访问的工具名集合，用于后续统计。

/**
 * Count memory file accesses in transcript entries.
 * Uses the same detection conditions as the PostToolUse session file access hooks.
 */
function countMemoryFileAccessFromEntries(
  entries: ReadonlyArray<Entry>,
): number {
// 统计转录条目中记忆文件的访问次数，判定逻辑与 PostToolUse 钩子保持一致。
  let count = 0
  for (const entry of entries) {
// 只统计 assistant 的 `tool_use` 且工具名落在记忆访问集合内。
    if (entry.type !== 'assistant') continue
    const content = entry.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (
        block.type !== 'tool_use' ||
        !MEMORY_ACCESS_TOOL_NAMES.has(block.name)
      )
        continue
      if (isMemoryFileAccess(block.name, block.input)) count++
    }
  }
  return count
// 命中记忆访问判定时计数加一，最后返回累计值。
}

/**
 * Read session transcript entries and compute prompt count and memory access
 * count. Pre-compact entries are skipped — the N-shot count and memory-access
 * count should reflect only the current conversation arc, not accumulated
 * prompts from before a compaction boundary.
 */
async function getTranscriptStats(): Promise<{
  promptCount: number
  memoryAccessCount: number
}> {
// 读取转录并统计提示数与记忆访问数；压缩边界之前的条目会被跳过。
  try {
    const filePath = getTranscriptPath()
    const fileSize = (await stat(filePath)).size
// 取转录路径与大小，准备按需读取而非全量加载。
    // Fused reader: attr-snap lines (84% of a long session by bytes) are
    // skipped at the fd level so peak scales with output, not file size. The
    // one surviving attr-snap at EOF is a no-op for the count functions
    // (neither checks type === 'attribution-snapshot'). When the last
    // boundary has preservedSegment the reader returns full (no truncate);
    // the findLastIndex below still slices to post-boundary.
// 融合读取器在 fd 层面跳过属性快照行，峰值随输出而非文件大小增长；保留边界后的片段用于统计。
    const scan = await readTranscriptForLoad(filePath, fileSize)
// 调用 `readTranscriptForLoad` 只取压缩边界之后的缓冲，长度更短、解析更快。
    const buf = scan.postBoundaryBuf
    const entries = parseJSONL<Entry>(buf)
    const lastBoundaryIdx = entries.findLastIndex(
      e =>
        e.type === 'system' &&
        'subtype' in e &&
        e.subtype === 'compact_boundary',
    )
    const postBoundary =
      lastBoundaryIdx >= 0 ? entries.slice(lastBoundaryIdx + 1) : entries
// 按最后一个 `compact_boundary` 切片，只保留当前对话弧的条目用于统计。
    return {
      promptCount: countUserPromptsFromEntries(postBoundary),
      memoryAccessCount: countMemoryFileAccessFromEntries(postBoundary),
// 返回提示数与记忆访问数的统计结果，交给上层拼装署名。
    }
  } catch {
    return { promptCount: 0, memoryAccessCount: 0 }
  }
}

/**
 * Get enhanced PR attribution text with Claude contribution stats.
 *
 * Format: "🤖 Generated with Claude Code (93% 3-shotted by claude-opus-4-5)"
 *
 * Rules:
 * - Shows Claude contribution percentage from commit attribution
 * - Shows N-shotted where N is the prompt count (1-shotted, 2-shotted, etc.)
 * - Shows short model name (e.g., claude-opus-4-5)
 * - Returns default attribution if stats can't be computed
 *
 * @param getAppState Function to get the current AppState (from command context)
 */
export async function getEnhancedPRAttribution(
// 增强版 PR 署名：在默认署名上附加 Claude 贡献百分比、N-shot 次数与召回记忆数。
  getAppState: () => AppState,
): Promise<string> {
  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
// 隐蔽模式下直接返回空字符串，不生成任何署名。
    return ''
  }

  if (getClientType() === 'remote') {
    const remoteSessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    if (remoteSessionId) {
      const ingressUrl = process.env.SESSION_INGRESS_URL
      // Skip for local dev - URLs won't persist
      if (!isRemoteSessionLocal(remoteSessionId, ingressUrl)) {
        return getRemoteSessionUrl(remoteSessionId, ingressUrl)
      }
    }
    return ''
  }
// 远程会话返回会话链接作为署名，本地开发无链接则回退空串。

  const settings = getInitialSettings()
// 读取初始设置，优先使用用户自定义 PR 署名。

  // If user has custom PR attribution, use that
  if (settings.attribution?.pr) {
// 用户自定义 PR 署名存在时直接返回，跳过后续统计。
    return settings.attribution.pr
  }

  // Backward compatibility: deprecated includeCoAuthoredBy setting
  if (settings.includeCoAuthoredBy === false) {
// 向后兼容已废弃的 `includeCoAuthoredBy` 关闭场景，返回空串。
    return ''
  }

  const defaultAttribution = `🤖 Generated with [Claude Code](${PRODUCT_URL})`

  // Get AppState first
  const appState = getAppState()
// 先取 `AppState`，再打印调试信息确认归因状态是否存在。

  logForDebugging(
    `PR Attribution: appState.attribution exists: ${!!appState.attribution}`,
  )
  if (appState.attribution) {
    const fileStates = appState.attribution.fileStates
    const isMap = fileStates instanceof Map
    const fileCount = isMap ? fileStates.size : Object.keys(fileStates).length
    logForDebugging(`PR Attribution: fileStates count: ${fileCount}`)
  }

  // Get attribution stats (transcript is read once for both prompt count and memory access)
// 并行获取归因数据、转录统计与是否内部仓库，转录只读一次。
  const [attributionData, { promptCount, memoryAccessCount }, isInternal] =
    await Promise.all([
      getPRAttributionData(appState),
      getTranscriptStats(),
      isInternalModelRepo(),
    ])
// 用 `Promise.all` 同时算出三项数据，提升响应速度。

  const claudePercent = attributionData?.summary.claudePercent ?? 0
// 取 Claude 贡献百分比，缺省为 0。

  logForDebugging(
    `PR Attribution: claudePercent: ${claudePercent}, promptCount: ${promptCount}, memoryAccessCount: ${memoryAccessCount}`,
  )

  // Get short model name, sanitized for non-internal repos
  const rawModelName = getCanonicalName(getMainLoopModel())
// 取短模型名，非内部仓库先经 `sanitize` 去掉内部代号。
  const shortModelName = isInternal
    ? rawModelName
    : sanitizeModelName(rawModelName)
// 内部仓库保留原始名，外部仓库用清洗后的公开名，避免泄露代号。

  // If no attribution data, return default
  if (claudePercent === 0 && promptCount === 0 && memoryAccessCount === 0) {
// 三项数据全为 0 时返回默认署名，因为没有任何可展示的统计信息。
    logForDebugging('PR Attribution: returning default (no data)')
    return defaultAttribution
  }

  // Build the enhanced attribution: "🤖 Generated with Claude Code (93% 3-shotted by claude-opus-4-5, 2 memories recalled)"
  const memSuffix =
    memoryAccessCount > 0
      ? `, ${memoryAccessCount} ${memoryAccessCount === 1 ? 'memory' : 'memories'} recalled`
      : ''
  const summary = `🤖 Generated with [Claude Code](${PRODUCT_URL}) (${claudePercent}% ${promptCount}-shotted by ${shortModelName}${memSuffix})`
// 拼装增强署名：百分比加 N-shot 次数加模型短名，可选追加召回记忆后缀。

  // Append trailer lines for squash-merge survival. Only for allowlisted repos
  // (INTERNAL_MODEL_REPOS) and only in builds with COMMIT_ATTRIBUTION enabled —
  // attributionTrailer.ts contains excluded strings, so reach it via dynamic
  // import behind feature(). When the repo is configured with
  // squash_merge_commit_message=PR_BODY (cli, apps), the PR body becomes the
  // squash commit body verbatim — trailer lines at the end become proper git
  // trailers on the squash commit.
// 仅内部仓库且启用 `COMMIT_ATTRIBUTION` 时动态导入尾注构建器，追加 trailer 行以保证 squash 合并后仍保留。
  if (feature('COMMIT_ATTRIBUTION') && isInternal && attributionData) {
// 满足条件时动态导入 `attributionTrailer.js` 并拼装 trailer，保证 squash 提交体带规范尾注。
    const { buildPRTrailers } = await import('./attributionTrailer.js')
    const trailers = buildPRTrailers(attributionData, appState.attribution)
// 用归因数据与状态构建 trailer 行，并与摘要拼接成最终结果。
    const result = `${summary}\n\n${trailers.join('\n')}`
    logForDebugging(`PR Attribution: returning with trailers: ${result}`)
    return result
  }

  logForDebugging(`PR Attribution: returning summary: ${summary}`)
  return summary
// 无尾注可加时直接返回增强署名摘要。
}
