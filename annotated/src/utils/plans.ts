// 本文件：管理会话级「计划（plan）」文件——slug 的惰性生成与缓存、计划目录的解析（含越界校验）、主会话与子智能体文件路径拼装、resume/fork 时的计划恢复，以及把计划/待办快照增量写进 transcript（仅远程会话）。
import { randomUUID } from 'crypto'
import { copyFile, writeFile } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { join, resolve, sep } from 'path'
// 类型导入：会话/智能体 ID、日志选项、以及恢复逻辑要用到的四类消息（助手/附件/系统文件快照/用户）。
import type { AgentId, SessionId } from 'src/types/ids.js'
import type { LogOption } from 'src/types/logs.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  SystemFileSnapshotMessage,
  UserMessage,
} from 'src/types/message.js'
import { getPlanSlugCache, getSessionId } from '../bootstrap/state.js'
// 从 `bootstrap/state` 取 plan slug 缓存与当前 session id——slug 按会话缓存。
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../tools/ExitPlanModeTool/constants.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { isENOENT } from './errors.js'
import { getEnvironmentKind } from './filePersistence/outputsScanner.js'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'
import { getInitialSettings } from './settings/settings.js'
// `getInitialSettings` 给 `getPlansDirectory` 用：计划目录优先读用户设置。
import { generateWordSlug } from './words.js'
// `generateWordSlug` 生成可读的单词 slug（如 `quiet-frog`），避免裸 UUID。

const MAX_SLUG_RETRIES = 10
// 唯一 slug 的重试上限：连续 10 次都撞名就放弃重试，直接用最后一个。

/**
 * Get or generate a word slug for the current session's plan.
 * The slug is generated lazily on first access and cached for the session.
 * If a plan file with the generated slug already exists, retries up to 10 times.
 */
// `getPlanSlug`：惰性生成并返回当前会话计划的单词 slug，首次访问才生成并缓存；若生成 slug 已存在同名文件则重试至上限。
export function getPlanSlug(sessionId?: SessionId): string {
  const id = sessionId ?? getSessionId()
// 优先用传入的 sessionId，否则取当前会话；先从缓存读。
  const cache = getPlanSlugCache()
  let slug = cache.get(id)
  if (!slug) {
    const plansDir = getPlansDirectory()
// 取计划目录（记忆化，建目录一并完成）。
    // Try to find a unique slug that doesn't conflict with existing files
    for (let i = 0; i < MAX_SLUG_RETRIES; i++) {
// 最多重试 `MAX_SLUG_RETRIES` 次，直到生成一个磁盘上不存在的 slug。
      slug = generateWordSlug()
      const filePath = join(plansDir, `${slug}.md`)
      if (!getFsImplementation().existsSync(filePath)) {
        break
      }
    }
    cache.set(id, slug!)
// 命中唯一 slug 后写回缓存（`slug!` 此时一定非空）。
  }
  return slug!
// 返回缓存里的 slug（非 null 断言，因为上面一定 set 过）。
}

/**
 * Set a specific plan slug for a session (used when resuming a session)
 */
// `setPlanSlug`：为某会话显式设定 slug（resume 恢复旧会话时用）。
export function setPlanSlug(sessionId: SessionId, slug: string): void {
  getPlanSlugCache().set(sessionId, slug)
// 直接写缓存，覆盖惰性生成的结果。
}

/**
 * Clear the plan slug for the current session.
 * This should be called on /clear to ensure a fresh plan file is used.
 */
// `clearPlanSlug`：`/clear` 时调用，清掉当前会话的 slug，使下次用全新计划文件。
export function clearPlanSlug(sessionId?: SessionId): void {
  const id = sessionId ?? getSessionId()
  getPlanSlugCache().delete(id)
// 从缓存删除该会话的 slug 项。
}

/**
 * Clear ALL plan slug entries (all sessions).
 * Use this on /clear to free sub-session slug entries.
 */
// `clearAllPlanSlugs`：清掉所有会话的 slug 缓存，供 `/clear` 释放子会话条目。
export function clearAllPlanSlugs(): void {
  getPlanSlugCache().clear()
// 清空整个 slug 缓存。
}

// Memoized: called from render bodies (FileReadTool/FileEditTool/FileWriteTool UI.tsx)
// and permission checks. Inputs (initial settings + cwd) are fixed at startup, so the
// mkdirSync result is stable for the session. Without memoization, each rendered tool
// message triggers a mkdirSync syscall (regressed in #20005).
// `getPlansDirectory`：记忆化地解析并返回计划目录——输入（初始设置 + cwd）启动时即固定，结果整会话稳定。`//` 注释说明了不加 memoize 会在每次渲染工具消息时多一次 mkdirSync 系统调用（#20005 回归过）。
export const getPlansDirectory = memoize(function getPlansDirectory(): string {
  const settings = getInitialSettings()
// 读初始设置里的 `plansDirectory`。
  const settingsDir = settings.plansDirectory
  let plansPath: string

  if (settingsDir) {
    // Settings.json (relative to project root)
    const cwd = getCwd()
    const resolved = resolve(cwd, settingsDir)
// 相对项目根的自定义目录先 resolve 成绝对路径。

    // Validate path stays within project root to prevent path traversal
    if (!resolved.startsWith(cwd + sep) && resolved !== cwd) {
// 越界校验：resolve 结果不在项目根内就记错并回退到默认目录，防路径穿越。
      logError(
        new Error(`plansDirectory must be within project root: ${settingsDir}`),
      )
      plansPath = join(getClaudeConfigHomeDir(), 'plans')
    } else {
      plansPath = resolved
    }
  } else {
    // Default
    plansPath = join(getClaudeConfigHomeDir(), 'plans')
  }

  // Ensure directory exists (mkdirSync with recursive: true is a no-op if it exists)
  try {
    getFsImplementation().mkdirSync(plansPath)
// 确保目录存在（`mkdirSync` 递归，已存在则是空操作）；失败只记日志不抛。
  } catch (error) {
    logError(error)
  }

  return plansPath
})

/**
 * Get the file path for a session's plan
 * @param agentId Optional agent ID for subagents. If not provided, returns main session plan.
 * For main conversation (no agentId), returns {planSlug}.md
 * For subagents (agentId provided), returns {planSlug}-agent-{agentId}.md
 */
// `getPlanFilePath`：拼出某会话计划文件路径——主会话为 `{slug}.md`，子智能体为 `{slug}-agent-{agentId}.md`。
export function getPlanFilePath(agentId?: AgentId): string {
  const planSlug = getPlanSlug(getSessionId())
// 先拿当前会话 slug（主会话路径用）。

  // Main conversation: simple filename with word slug
  if (!agentId) {
    return join(getPlansDirectory(), `${planSlug}.md`)
// 主会话：直接返回 `{slug}.md` 全路径。
  }

  // Subagents: include agent ID
  return join(getPlansDirectory(), `${planSlug}-agent-${agentId}.md`)
// 子智能体：在文件名里带上 agentId，避免和主会话计划文件互相覆盖。
}

/**
 * Get the plan content for a session
 * @param agentId Optional agent ID for subagents. If not provided, returns main session plan.
 */
// `getPlan`：读取某会话计划文件内容；不存在或读失败都返回 `null`（不抛）。
export function getPlan(agentId?: AgentId): string | null {
  const filePath = getPlanFilePath(agentId)
  try {
    return getFsImplementation().readFileSync(filePath, { encoding: 'utf-8' })
// 以 utf-8 读整个计划文件。
  } catch (error) {
    if (isENOENT(error)) return null
    logError(error)
// `ENOENT` 视为「无计划」返回 null；其它错误记日志后同样返回 null。
    return null
  }
}

/**
 * Extract the plan slug from a log's message history.
 */
// `getSlugFromLog`：从日志消息历史里取第一个带 `slug` 的消息，作为恢复依据。
function getSlugFromLog(log: LogOption): string | undefined {
  return log.messages.find(m => m.slug)?.slug
}
// 返回首条带 slug 字段的消息的 slug（没有则 undefined）。

/**
 * Restore plan slug from a resumed session.
 * Sets the slug in the session cache so getPlanSlug returns it.
 * If the plan file is missing, attempts to recover it from a file snapshot
 * (written incrementally during the session) or from message history.
 * Returns true if a plan file exists (or was recovered) for the slug.
 * @param log The log to restore from
 * @param targetSessionId The session ID to associate the plan slug with.
 *                        This should be the ORIGINAL session ID being resumed,
 *                        not the temporary session ID from before resume.
 */
// `copyPlanForResume`：resume 时把计划 slug 绑到目标会话；计划文件若丢失则尝试从文件快照或消息历史恢复。返回是否存在（或恢复出）计划文件。
export async function copyPlanForResume(
  log: LogOption,
  targetSessionId?: SessionId,
): Promise<boolean> {
  const slug = getSlugFromLog(log)
  if (!slug) {
    return false
  }

  // Set the slug for the target session ID (or current if not provided)
  const sessionId = targetSessionId ?? getSessionId()
  setPlanSlug(sessionId, slug)
// 有 slug 就先绑到目标会话（用原始会话 id，而非 resume 前的临时 id）。

  // Attempt to read the plan file directly — recovery triggers on ENOENT.
  const planPath = join(getPlansDirectory(), `${slug}.md`)
  try {
    await getFsImplementation().readFile(planPath, { encoding: 'utf-8' })
// 优先直接读计划文件；读到了就无需恢复，直接返回成功。
    return true
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      // Don't throw — called fire-and-forget (void copyPlanForResume(...)) with no .catch()
      logError(e)
      return false
    }
    // Only attempt recovery in remote sessions (CCR) where files don't persist
    if (getEnvironmentKind() === null) {
      return false
    }

    logForDebugging(
      `Plan file missing during resume: ${planPath}. Attempting recovery.`,
    )

    // Try file snapshot first (written incrementally during session)
    const snapshotPlan = findFileSnapshotEntry(log.messages, 'plan')
// 恢复路径：先找文件快照条目（会话中增量写的），有内容就采用。
    let recovered: string | null = null
    if (snapshotPlan && snapshotPlan.content.length > 0) {
      recovered = snapshotPlan.content
      logForDebugging(
        `Plan recovered from file snapshot, ${recovered.length} chars`,
        { level: 'info' },
      )
    } else {
      // Fall back to searching message history
      recovered = recoverPlanFromMessages(log)
      if (recovered) {
        logForDebugging(
          `Plan recovered from message history, ${recovered.length} chars`,
          { level: 'info' },
        )
      }
    }

    if (recovered) {
      try {
        await writeFile(planPath, recovered, { encoding: 'utf-8' })
        return true
      } catch (writeError) {
        logError(writeError)
        return false
      }
    }
    logForDebugging(
      'Plan file recovery failed: no file snapshot or plan content found in message history',
    )
    return false
  }
}

/**
 * Copy a plan file for a forked session. Unlike copyPlanForResume (which reuses
 * the original slug), this generates a NEW slug for the forked session and
 * writes the original plan content to the new file. This prevents the original
 * and forked sessions from clobbering each other's plan files.
 */
// `copyPlanForFork`：fork 会话时复制计划文件——与 resume 不同，这里生成「新 slug」并写到新文件，避免原会话与 fork 会话互相覆盖计划文件。
export async function copyPlanForFork(
  log: LogOption,
  targetSessionId: SessionId,
): Promise<boolean> {
  const originalSlug = getSlugFromLog(log)
// 先取原会话 slug 作为复制源。
  if (!originalSlug) {
    return false
  }

  const plansDir = getPlansDirectory()
// 取目标会话的计划目录，并用其 slug 生成新文件名。
  const originalPlanPath = join(plansDir, `${originalSlug}.md`)

  // Generate a new slug for the forked session (do NOT reuse the original)
  const newSlug = getPlanSlug(targetSessionId)
  const newPlanPath = join(plansDir, `${newSlug}.md`)
  try {
    await copyFile(originalPlanPath, newPlanPath)
// 复制原计划内容到新文件；`ENOENT`（原文件不存在）静默返回失败，其它错误记日志。
    return true
  } catch (error) {
    if (isENOENT(error)) {
      return false
    }
    logError(error)
    return false
  }
}

/**
 * Recover plan content from the message history. Plan content can appear in
 * three forms depending on what happened during the session:
 *
 * 1. ExitPlanMode tool_use input — normalizeToolInput injects the plan content
 *    into the tool_use input, which persists in the transcript.
 *
 * 2. planContent field on user messages — set during the "clear context and
 *    implement" flow when ExitPlanMode is approved.
 *
 * 3. plan_file_reference attachment — created by auto-compact to preserve the
 *    plan across compaction boundaries.
 */
// `recoverPlanFromMessages`：从消息历史倒序找回计划内容，三种来源——ExitPlanMode 工具调用的 `plan` 输入、用户消息的 `planContent` 字段、auto-compact 产生的 `plan_file_reference` 附件。
function recoverPlanFromMessages(log: LogOption): string | null {
  for (let i = log.messages.length - 1; i >= 0; i--) {
    const msg = log.messages[i]
    if (!msg) {
      continue
    }

    if (msg.type === 'assistant') {
      const { content } = (msg as AssistantMessage).message
// 助手消息：取出消息体内容，准备扫工具调用块。
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block.type === 'tool_use' &&
            block.name === EXIT_PLAN_MODE_V2_TOOL_NAME
          ) {
// 命中 ExitPlanMode v2 工具调用且其 `plan` 输入非空，就作为计划内容返回。
            const input = block.input as Record<string, unknown> | undefined
            const plan = input?.plan
            if (typeof plan === 'string' && plan.length > 0) {
// `plan` 输入须是非空字符串才采用。
              return plan
            }
          }
        }
      }
    }

    if (msg.type === 'user') {
      const userMsg = msg as UserMessage
      if (
        typeof userMsg.planContent === 'string' &&
// 用户消息：若 `planContent` 是非空字符串则采用（clear 上下文后实现流程会写入）。
        userMsg.planContent.length > 0
      ) {
        return userMsg.planContent
      }
    }

    if (msg.type === 'attachment') {
      const attachmentMsg = msg as AttachmentMessage
      if (attachmentMsg.attachment?.type === 'plan_file_reference') {
// 附件消息：类型为 `plan_file_reference` 且含非空 `planContent` 则采用（auto-compact 跨压缩边界保留计划）。
        const plan = (attachmentMsg.attachment as { planContent?: string })
          .planContent
        if (typeof plan === 'string' && plan.length > 0) {
          return plan
        }
      }
    }
  }
  return null
}

/**
 * Find a file entry in the most recent file-snapshot system message in the transcript.
 * Scans backwards to find the latest snapshot.
 */
// `findFileSnapshotEntry`：从最近一条 `file_snapshot` 系统消息里找指定 key 的文件条目（倒序扫到最新快照）。
function findFileSnapshotEntry(
  messages: LogOption['messages'],
  key: string,
): { key: string; path: string; content: string } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (
      msg?.type === 'system' &&
      'subtype' in msg &&
      msg.subtype === 'file_snapshot' &&
      'snapshotFiles' in msg
    ) {
// 只认 `subtype === 'file_snapshot'` 且带 `snapshotFiles` 的系统消息。
      const files = msg.snapshotFiles as Array<{
        key: string
        path: string
        content: string
      }>
      return files.find(f => f.key === key)
    }
// 在快照文件列表里按 key 精确匹配返回。
  }
  return undefined
}

/**
 * Persist a snapshot of session files (plan, todos) to the transcript.
 * Called incrementally whenever these files change. Only active in remote
 * sessions (CCR) where local files don't persist between sessions.
 */
// `persistFileSnapshotIfRemote`：把计划/待办等会话文件快照增量写进 transcript；仅在远程会话（CCR）调用，因为本地文件跨会话不持久。
export async function persistFileSnapshotIfRemote(): Promise<void> {
  if (getEnvironmentKind() === null) {
    return
  }
  try {
    const snapshotFiles: SystemFileSnapshotMessage['snapshotFiles'] = []

    // Snapshot plan file
    const plan = getPlan()
// 快照当前计划文件内容（有才加进待写列表）。
    if (plan) {
      snapshotFiles.push({
        key: 'plan',
        path: getPlanFilePath(),
        content: plan,
      })
    }

    if (snapshotFiles.length === 0) {
// 没有任何快照内容就提前返回，不写空消息。
      return
    }

    const message: SystemFileSnapshotMessage = {
      type: 'system',
      subtype: 'file_snapshot',
      content: 'File snapshot',
      level: 'info',
      isMeta: true,
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
// 组装系统文件快照消息并动态 import `sessionStorage` 写回 transcript。
      snapshotFiles,
    }

    const { recordTranscript } = await import('./sessionStorage.js')
    await recordTranscript([message])
  } catch (error) {
    logError(error)
  }
}
