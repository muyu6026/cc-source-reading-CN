import type { UUID } from 'crypto'
import type { FileHistorySnapshot } from 'src/utils/fileHistory.js'
import type { ContentReplacementRecord } from 'src/utils/toolResultStorage.js'
import type { AgentId } from './ids.js'
import type { Message } from './message.js'
import type { QueueOperationMessage } from './messageQueueTypes.js'

// 落盘的每条消息都带一份运行环境快照：恢复会话时靠它还原当时的工作目录与来源
export type SerializedMessage = Message & {
  cwd: string
  userType: string
// 入口标识区分命令行、TS SDK、Python SDK，用来判断这段历史是哪条链路写下的
  entrypoint?: string // CLAUDE_CODE_ENTRYPOINT — distinguishes cli/sdk-ts/sdk-py/etc.
  sessionId: string
  timestamp: string
  version: string
  gitBranch?: string
  slug?: string // Session slug for files like plans (used for resume)
}

// 列表项是消息数组与显示元数据的混合体：一半来自文件，一半在加载时算出
export type LogOption = {
  date: string
  messages: SerializedMessage[]
  fullPath?: string
  value: number
  created: Date
  modified: Date
  firstPrompt: string
  messageCount: number
  fileSize?: number // File size in bytes (for display)
  isSidechain: boolean
// 轻量日志只读元数据不读消息体，列表页因此不必把几百个会话全解进内存
  isLite?: boolean // True for lite logs (messages not loaded)
  sessionId?: string // Session ID for lite logs
  teamName?: string // Team name if this is a spawned agent session
  agentName?: string // Agent's custom name (from /rename or swarm)
  agentColor?: string // Agent's color (from /rename or swarm)
  agentSetting?: string // Agent definition used (from --agent flag or settings.agent)
  isTeammate?: boolean // Whether this session was created by a swarm teammate
// 锚点式过滤：给定 uuid 后必须能在库里找到，否则说明这份日志与索引对不上
  leafUuid?: UUID // If given, this uuid must appear in the DB
  summary?: string // Optional conversation summary
  customTitle?: string // Optional user-set custom title
  tag?: string // Optional tag for the session (searchable in /resume)
  fileHistorySnapshots?: FileHistorySnapshot[] // Optional file history snapshots
  attributionSnapshots?: AttributionSnapshotMessage[] // Optional attribution snapshots
// 两个压缩相关字段写入语义相反：提交是只追加按序重放，快照是后者覆盖前者
  contextCollapseCommits?: ContextCollapseCommitEntry[] // Ordered — commit B may reference commit A's summary
  contextCollapseSnapshot?: ContextCollapseSnapshotEntry // Last-wins — staged queue + spawn state
  gitBranch?: string // Git branch at the end of the session
  projectPath?: string // Original project directory path
  prNumber?: number // GitHub PR number linked to this session
  prUrl?: string // Full URL to the linked PR
  prRepository?: string // Repository in "owner/repo" format
  mode?: 'coordinator' | 'normal' // Session mode for coordinator/normal detection
// null 与 undefined 是三态：null 表示进过又出来了，undefined 表示从没进去过
  worktreeSession?: PersistedWorktreeSession | null // Worktree state at session end (null = exited, undefined = never entered)
  contentReplacements?: ContentReplacementRecord[] // Replacement decisions for resume reconstruction
}

// 摘要消息不进消息数组，只作为旁挂记录被恢复流程消费
export type SummaryMessage = {
  type: 'summary'
  leafUuid: UUID
  summary: string
}

export type CustomTitleMessage = {
  type: 'custom-title'
  sessionId: UUID
  customTitle: string
}

// AI 标题与用户改名分成两种记录，是为了让读取偏好稳定：改名的优先级永远更高
/**
 * AI-generated session title. Distinct from CustomTitleMessage so that:
 * - User renames (custom-title) always win over AI titles in read preference
 * - reAppendSessionMetadata never re-appends AI titles (they're ephemeral/
 *   regeneratable; re-appending would clobber user renames on resume)
 * - VS Code's onlyIfNoCustomTitle CAS check only matches user titles,
 *   allowing AI to overwrite its own previous AI title but not user titles
 */
// 单独一种类型还解决两个问题：重写元数据时不会覆盖用户改名，条件更新也只匹配用户标题
export type AiTitleMessage = {
  type: 'ai-title'
  sessionId: UUID
  aiTitle: string
}

// 最后一条提示词单独落盘：会话列表要显示它，但不必加载全部消息
export type LastPromptMessage = {
  type: 'last-prompt'
  sessionId: UUID
  lastPrompt: string
}

/**
 * Periodic fork-generated summary of what the agent is currently doing.
 * Written every min(5 steps, 2min) by forking the main thread mid-turn so
 * `claude ps` can show something more useful than the last user prompt
 * (which is often "ok go" or "fix it").
 */
// 任务摘要是旁路生成的：中途分叉主线程写一条，让进程列表能显示在做什么而不是上一条指令
export type TaskSummaryMessage = {
  type: 'task-summary'
  sessionId: UUID
  summary: string
  timestamp: string
}

export type TagMessage = {
  type: 'tag'
  sessionId: UUID
  tag: string
}

export type AgentNameMessage = {
  type: 'agent-name'
  sessionId: UUID
  agentName: string
}

export type AgentColorMessage = {
  type: 'agent-color'
  sessionId: UUID
  agentColor: string
}

export type AgentSettingMessage = {
  type: 'agent-setting'
  sessionId: UUID
  agentSetting: string
}

/**
 * PR link message stored in session transcript.
 * Links a session to a GitHub pull request for tracking and navigation.
 */
// PR 链接作为独立条目：会话与拉取请求的关联要能单独检索与更新
export type PRLinkMessage = {
  type: 'pr-link'
  sessionId: UUID
  prNumber: number
  prUrl: string
  prRepository: string // e.g., "owner/repo"
  timestamp: string // ISO timestamp when linked
}

// 协调者与普通模式的标记也就一条记录，恢复时读最后一条
export type ModeEntry = {
  type: 'mode'
  sessionId: UUID
  mode: 'coordinator' | 'normal'
}

/**
 * Worktree session state persisted to the transcript for resume.
 * Subset of WorktreeSession from utils/worktree.ts — excludes ephemeral
 * fields (creationDurationMs, usedSparsePaths) that are only used for
 * first-run analytics.
 */
// 持久化结构刻意比内存结构窄：只留恢复需要的字段，首次运行的计时数据不落盘
export type PersistedWorktreeSession = {
  originalCwd: string
  worktreePath: string
  worktreeName: string
  worktreeBranch?: string
  originalBranch?: string
  originalHeadCommit?: string
  sessionId: string
  tmuxSessionName?: string
  hookBased?: boolean
}

/**
 * Records whether the session is currently inside a worktree created by
 * EnterWorktree or --worktree. Last-wins: an enter writes the session,
 * an exit writes null. On --resume, restored only if the worktreePath
 * still exists on disk (the /exit dialog may have removed it).
 */
// 工作树状态同样是覆盖语义：进入写对象、退出写 null，恢复时还要确认目录仍在
export type WorktreeStateEntry = {
  type: 'worktree-state'
  sessionId: UUID
  worktreeSession: PersistedWorktreeSession | null
}

/**
 * Records content blocks whose in-context representation was replaced with a
 * smaller stub (the full content was persisted elsewhere). Replayed on resume
 * for prompt cache stability. Written once per enforcement pass that replaces
 * at least one block. When agentId is set, the record belongs to a subagent
 * sidechain (AgentTool resume reads these); when absent, it's main-thread
 * (/resume reads these).
 */
// 内容替换记录一次写入覆盖整轮扫描的全部替换项，重放时按顺序还原
export type ContentReplacementEntry = {
  type: 'content-replacement'
  sessionId: UUID
// 有 agentId 就是子代理侧链、没有就是主线程：两条恢复路径靠这个字段分流
  agentId?: AgentId
  replacements: ContentReplacementRecord[]
}

export type FileHistorySnapshotMessage = {
  type: 'file-history-snapshot'
  messageId: UUID
  snapshot: FileHistorySnapshot
  isSnapshotUpdate: boolean
}

/**
 * Per-file attribution state tracking Claude's character contributions.
 */
// 归属状态按文件记：内容哈希决定是否过期，贡献字数决定提交时的署名比例
export type FileAttributionState = {
  contentHash: string // SHA-256 hash of file content
  claudeContribution: number // Characters written by Claude
  mtime: number // File modification time
}

/**
 * Attribution snapshot message stored in session transcript.
 * Tracks character-level contributions by Claude for commit attribution.
 */
export type AttributionSnapshotMessage = {
  type: 'attribution-snapshot'
  messageId: UUID
  surface: string // Client surface (cli, ide, web, api)
  fileStates: Record<string, FileAttributionState>
  promptCount?: number // Total prompts in session
  promptCountAtLastCommit?: number // Prompts at last commit
  permissionPromptCount?: number // Total permission prompts shown
  permissionPromptCountAtLastCommit?: number // Permission prompts at last commit
  escapeCount?: number // Total ESC presses (cancelled permission prompts)
  escapeCountAtLastCommit?: number // ESC presses at last commit
}

// 会话记录在消息基础上加父子链：恢复时靠它重建树，而不是靠时间戳猜顺序
export type TranscriptMessage = SerializedMessage & {
  parentUuid: UUID | null
// 父指针被置空时仍保留逻辑父节点：会话断点不该把消息树也切断
  logicalParentUuid?: UUID | null // Preserves logical parent when parentUuid is nullified for session breaks
  isSidechain: boolean
  gitBranch?: string
  agentId?: string // Agent ID for sidechain transcripts to enable resuming agents
  teamName?: string // Team name if this is a spawned agent session
  agentName?: string // Agent's custom name (from /rename or swarm)
  agentColor?: string // Agent's color (from /rename or swarm)
  promptId?: string // Correlates with OTel prompt.id for user prompt messages
}

// 推测被接受的记录只存省下多少时间，用于统计而不是重放
export type SpeculationAcceptMessage = {
  type: 'speculation-accept'
  timestamp: string
  timeSavedMs: number
}

/**
 * Persisted context-collapse commit. The archived messages themselves are
 * NOT persisted — they're already in the transcript as ordinary user/
 * assistant messages. We only persist enough to reconstruct the splice
 * instruction (boundary uuids) and the summary placeholder (which is NOT
 * in the transcript because it's never yielded to the REPL).
 *
 * On restore, the store reconstructs CommittedCollapse with archived=[];
 * projectView lazily fills the archive the first time it finds the span.
 *
 * Discriminator is obfuscated to match the gate name. sessionStorage.ts
 * isn't feature-gated (it's the generic transcript plumbing used by every
 * entry type), so a descriptive string here would leak into external builds
 * via the appendEntry dispatch / loadTranscriptFile parser even though
 * nothing in an external build ever writes or reads this entry.
 */
// 压缩提交只存边界与摘要占位，归档消息本身不重复落盘，因为它们在会话记录里已经有了
export type ContextCollapseCommitEntry = {
  type: 'marble-origami-commit'
// 判定字符串故意起得看不出含义：这段管道是通用的，可读的名字会被打进外部构建
  sessionId: UUID
  /** 16-digit collapse ID. Max across entries reseeds the ID counter. */
// 压缩编号取全部条目最大值再自增：恢复后新编号不会与旧的重号
  collapseId: string
  /** The summary placeholder's uuid — registerSummary() needs it. */
  summaryUuid: string
  /** Full <collapsed id="...">text</collapsed> string for the placeholder. */
  summaryContent: string
  /** Plain summary text for ctx_inspect. */
  summary: string
  /** Span boundaries — projectView finds these in the resumed Message[]. */
  firstArchivedUuid: string
  lastArchivedUuid: string
}

/**
 * Snapshot of the staged queue and spawn trigger state. Unlike commits
 * (append-only, replay-all), snapshots are last-wins — only the most
 * recent snapshot entry is applied on restore. Written after every
 * ctx-agent spawn resolves (when staged contents may have changed).
 *
 * Staged boundaries are UUIDs (session-stable), not collapse IDs (which
 * reset with the uuidToId bimap). Restoring a staged span issues fresh
 * collapse IDs for those messages on the next decorate/display, but the
 * span itself resolves correctly.
 */
// 快照只应用最近一条：暂存内容与触发状态是当前值，不是历史序列
export type ContextCollapseSnapshotEntry = {
  type: 'marble-origami-snapshot'
  sessionId: UUID
  staged: Array<{
// 暂存边界用会话内稳定的 uuid 而不是压缩编号：编号会随映射重建而复位
    startUuid: string
    endUuid: string
    summary: string
    risk: number
    stagedAt: number
  }>
  /** Spawn trigger state — so the +interval clock picks up where it left off. */
  armed: boolean
  lastSpawnTokens: number
}

// 联合类型就是解析分派表：新增条目类型必须同时加进这里，否则读取时会被静默丢弃
export type Entry =
  | TranscriptMessage
  | SummaryMessage
  | CustomTitleMessage
  | AiTitleMessage
  | LastPromptMessage
  | TaskSummaryMessage
  | TagMessage
  | AgentNameMessage
  | AgentColorMessage
  | AgentSettingMessage
  | PRLinkMessage
  | FileHistorySnapshotMessage
  | AttributionSnapshotMessage
  | QueueOperationMessage
  | SpeculationAcceptMessage
  | ModeEntry
  | WorktreeStateEntry
  | ContentReplacementEntry
  | ContextCollapseCommitEntry
  | ContextCollapseSnapshotEntry

// 排序先按修改时间倒序，相同时按创建时间倒序：同一批导入的会话靠第二级稳定下来
export function sortLogs(logs: LogOption[]): LogOption[] {
// 原地排序并返回同一个数组：调用方经常拿它直接当渲染数据，多拷贝一份没有收益
  return logs.sort((a, b) => {
    // Sort by modified date (newest first)
    const modifiedDiff = b.modified.getTime() - a.modified.getTime()
    if (modifiedDiff !== 0) {
      return modifiedDiff
    }

    // If modified dates are equal, sort by created date (newest first)
    return b.created.getTime() - a.created.getTime()
  })
}
