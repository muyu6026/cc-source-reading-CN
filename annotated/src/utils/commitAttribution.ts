import { createHash, randomUUID, type UUID } from 'crypto'
import { stat } from 'fs/promises'
import { isAbsolute, join, relative, sep } from 'path'
import { getOriginalCwd, getSessionId } from '../bootstrap/state.js'
import type {
  AttributionSnapshotMessage,
  FileAttributionState,
} from '../types/logs.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import { isGeneratedFile } from './generatedFiles.js'
import { getRemoteUrlForDir, resolveGitDir } from './git/gitFilesystem.js'
import { findGitRoot, gitExe } from './git.js'
import { logError } from './log.js'
import { getCanonicalName, type ModelName } from './model/model.js'
import { sequential } from './sequential.js'

/**
 * List of repos where internal model names are allowed in trailers.
 * Includes both SSH and HTTPS URL formats.
 *
 * NOTE: This is intentionally a repo allowlist, not an org-wide check.
 * The anthropics and anthropic-experimental orgs contain PUBLIC repos
 * (e.g. anthropics/claude-code, anthropic-experimental/sandbox-runtime).
 * Undercover mode must stay ON in those to prevent codename leaks.
 * Only add repos here that are confirmed PRIVATE.
 */
// 内部模型名允许出现在 commit trailer 的仓库白名单：同时收录 SSH 与 HTTPS 两种 URL 形式。注意这里是「按仓库」放行而非「按组织」——anthropics 与 anthropic-experimental 组织里也有公开仓库（如 claude-code、sandbox-runtime），那些必须保持 undercover 模式开启以防代号泄露；只有确认是私有的仓库才加进来。
const INTERNAL_MODEL_REPOS = [
  'github.com:anthropics/claude-cli-internal',
  'github.com/anthropics/claude-cli-internal',
  'github.com:anthropics/anthropic',
  'github.com/anthropics/anthropic',
  'github.com:anthropics/apps',
  'github.com/anthropics/apps',
  'github.com:anthropics/casino',
  'github.com/anthropics/casino',
  'github.com:anthropics/dbt',
  'github.com/anthropics/dbt',
  'github.com:anthropics/dotfiles',
  'github.com/anthropics/dotfiles',
  'github.com:anthropics/terraform-config',
  'github.com/anthropics/terraform-config',
  'github.com:anthropics/hex-export',
  'github.com/anthropics/hex-export',
  'github.com:anthropics/feedback-v2',
  'github.com/anthropics/feedback-v2',
  'github.com:anthropics/labs',
  'github.com/anthropics/labs',
  'github.com:anthropics/argo-rollouts',
  'github.com/anthropics/argo-rollouts',
  'github.com:anthropics/starling-configs',
  'github.com/anthropics/starling-configs',
  'github.com:anthropics/ts-tools',
  'github.com/anthropics/ts-tools',
  'github.com:anthropics/ts-capsules',
  'github.com/anthropics/ts-capsules',
  'github.com:anthropics/feldspar-testing',
  'github.com/anthropics/feldspar-testing',
  'github.com:anthropics/trellis',
  'github.com/anthropics/trellis',
  'github.com:anthropics/claude-for-hiring',
  'github.com/anthropics/claude-for-hiring',
  'github.com:anthropics/forge-web',
  'github.com/anthropics/forge-web',
  'github.com:anthropics/infra-manifests',
  'github.com/anthropics/infra-manifests',
  'github.com:anthropics/mycro_manifests',
  'github.com/anthropics/mycro_manifests',
  'github.com:anthropics/mycro_configs',
  'github.com/anthropics/mycro_configs',
  'github.com:anthropics/mobile-apps',
  'github.com/anthropics/mobile-apps',
]

/**
 * Get the repo root for attribution operations.
 * Uses getCwd() which respects agent worktree overrides (AsyncLocalStorage),
 * then resolves to git root to handle `cd subdir` case.
 * Falls back to getOriginalCwd() if git root can't be determined.
 */
// 取归因用的仓库根：先取 cwd（尊重 agent 的 worktree 覆盖，基于 AsyncLocalStorage），再解析到 git 根以处理 cd 进子目录的情况；解析不出 git 根就退回原始工作目录。
export function getAttributionRepoRoot(): string {
  const cwd = getCwd()
  return findGitRoot(cwd) ?? getOriginalCwd()
}

// Cache for repo classification result. Primed once per process.
// 'internal' = remote matches INTERNAL_MODEL_REPOS allowlist
// 'external' = has a remote, not on allowlist (public/open-source repo)
// 'none'     = no remote URL (not a git repo, or no remote configured)
// 仓库分类结果的进程级缓存：internal 表示远程命中白名单、external 表示有远程但不在白名单（公开仓库）、none 表示没有远程。每个进程只算一次。
let repoClassCache: 'internal' | 'external' | 'none' | null = null

/**
 * Synchronously return the cached repo classification.
 * Returns null if the async check hasn't run yet.
 */
// 同步返回缓存里的仓库分类；若异步检查还没跑过则返回 null。
export function getRepoClassCached(): 'internal' | 'external' | 'none' | null {
  return repoClassCache
}

/**
 * Synchronously return the cached result of isInternalModelRepo().
 * Returns false if the check hasn't run yet (safe default: don't leak).
 */
// 同步返回「是否在内部模型仓库」的缓存结果；检查还没跑过时返回 false——安全默认值：宁可不要泄露。
export function isInternalModelRepoCached(): boolean {
  return repoClassCache === 'internal'
}

/**
 * Check if the current repo is in the allowlist for internal model names.
 * Memoized - only checks once per process.
 */
// 判断是否处于「允许用内部模型名」的白名单仓库：用 sequential 包成「每进程只查一次」。先解析仓库根、取远程 URL，命中白名单任一项即 internal，否则 external；没有远程就是 none。
export const isInternalModelRepo = sequential(async (): Promise<boolean> => {
  if (repoClassCache !== null) {
    return repoClassCache === 'internal'
  }

  const cwd = getAttributionRepoRoot()
  const remoteUrl = await getRemoteUrlForDir(cwd)

  if (!remoteUrl) {
    repoClassCache = 'none'
    return false
  }
  const isInternal = INTERNAL_MODEL_REPOS.some(repo => remoteUrl.includes(repo))
  repoClassCache = isInternal ? 'internal' : 'external'
  return isInternal
})

/**
 * Sanitize a surface key to use public model names.
 * Converts internal model variants to their public equivalents.
 */
// 把 surface key 规整成「公开模型名」版本：按最后一个斜杠拆成 surface 与 model 两段，对 model 段跑一遍模型名净化，再拼回 surface/净化后模型。
export function sanitizeSurfaceKey(surfaceKey: string): string {
  // Split surface key into surface and model parts (e.g., "cli/opus-4-5-fast" -> ["cli", "opus-4-5-fast"])
  const slashIndex = surfaceKey.lastIndexOf('/')
  if (slashIndex === -1) {
    return surfaceKey
  }

  const surface = surfaceKey.slice(0, slashIndex)
  const model = surfaceKey.slice(slashIndex + 1)
  const sanitizedModel = sanitizeModelName(model)

  return `${surface}/${sanitizedModel}`
}

// @[MODEL LAUNCH]: Add a mapping for the new model ID so git commit trailers show the public name.
/**
 * Sanitize a model name to its public equivalent.
 * Maps internal variants to their public names based on model family.
 */
// 把内部模型名映射到公开等价名：按模型家族逐级判断（opus-4-6 / opus-4-5 / sonnet-4-6 …），命中哪个家族就返回对应的 claude-xxx 公开名；不认识的统归为 claude。新增模型时在 @[MODEL LAUNCH] 注释处补一条映射，否则 trailer 会显示内部名。
export function sanitizeModelName(shortName: string): string {
  // Map internal variants to public equivalents based on model family
  if (shortName.includes('opus-4-6')) return 'claude-opus-4-6'
  if (shortName.includes('opus-4-5')) return 'claude-opus-4-5'
  if (shortName.includes('opus-4-1')) return 'claude-opus-4-1'
  if (shortName.includes('opus-4')) return 'claude-opus-4'
  if (shortName.includes('sonnet-4-6')) return 'claude-sonnet-4-6'
  if (shortName.includes('sonnet-4-5')) return 'claude-sonnet-4-5'
  if (shortName.includes('sonnet-4')) return 'claude-sonnet-4'
  if (shortName.includes('sonnet-3-7')) return 'claude-sonnet-3-7'
  if (shortName.includes('haiku-4-5')) return 'claude-haiku-4-5'
  if (shortName.includes('haiku-3-5')) return 'claude-haiku-3-5'
  // Unknown models get a generic name
  return 'claude'
}

/**
 * Attribution state for tracking Claude's contributions to files.
 */
// 一次会话的归因状态：fileStates 按相对路径记每个文件的 Claude 贡献；sessionBaselines 记会话基线（内容哈希 + mtime）用于算净变更；surface 记编辑来自哪个端；startingHeadSha 记会话开始时的 HEAD（用来检测外部提交）；还有 promptCount / permissionPromptCount / escapeCount 及其「上次提交时」的快照值，用于算每次提交的 steer 数。
export type AttributionState = {
  // File states keyed by relative path (from cwd)
  fileStates: Map<string, FileAttributionState>
  // Session baseline states for net change calculation
  sessionBaselines: Map<string, { contentHash: string; mtime: number }>
  // Surface from which edits were made
  surface: string
  // HEAD SHA at session start (for detecting external commits)
  startingHeadSha: string | null
  // Total prompts in session (for steer count calculation)
  promptCount: number
  // Prompts at last commit (to calculate steers for current commit)
  promptCountAtLastCommit: number
  // Permission prompt tracking
  permissionPromptCount: number
  permissionPromptCountAtLastCommit: number
  // ESC press tracking (user cancelled permission prompt)
  escapeCount: number
  escapeCountAtLastCommit: number
}

/**
 * Summary of Claude's contribution for a commit.
 */
// 一次提交里 Claude 贡献的汇总：Claude 占比、Claude 字符数、人类字符数、涉及的 surface 列表。
export type AttributionSummary = {
  claudePercent: number
  claudeChars: number
  humanChars: number
  surfaces: string[]
}

/**
 * Per-file attribution details for git notes.
 */
// 写进 git notes 的「每文件」归因明细：Claude 字符、人类字符、占比、来源 surface。
export type FileAttribution = {
  claudeChars: number
  humanChars: number
  percent: number
  surface: string
}

/**
 * Full attribution data for git notes JSON.
 */
// git notes JSON 的完整归因数据：版本号、汇总、每文件明细、按 surface 的构成分解、被排除的生成文件列表、会话 ID 列表。
export type AttributionData = {
  version: 1
  summary: AttributionSummary
  files: Record<string, FileAttribution>
  surfaceBreakdown: Record<string, { claudeChars: number; percent: number }>
  excludedGenerated: string[]
  sessions: string[]
}

/**
 * Get the current client surface from environment.
 */
// 从环境变量取当前客户端 surface：取 CLAUDE_CODE_ENTRYPOINT，没设就默认 cli。
export function getClientSurface(): string {
  return process.env.CLAUDE_CODE_ENTRYPOINT ?? 'cli'
}

/**
 * Build a surface key that includes the model name.
 * Format: "surface/model" (e.g., "cli/claude-sonnet")
 */
// 构造带模型名的 surface key：格式 surface/model（如 cli/claude-sonnet），模型名用 getCanonicalName 归一到规范名。
export function buildSurfaceKey(surface: string, model: ModelName): string {
  return `${surface}/${getCanonicalName(model)}`
}

/**
 * Compute SHA-256 hash of content.
 */
// 算内容的 SHA-256 哈希：用于给文件状态做内容指纹，比对基线是否变化。
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Normalize file path to relative path from cwd for consistent tracking.
 * Resolves symlinks to handle /tmp vs /private/tmp on macOS.
 */
// 把文件路径归一化成「相对 cwd 的相对路径」以便一致追踪：会解析符号链接（如 macOS 上 /tmp 与 /private/tmp），并把分隔符统一成正斜杠以兼容 Windows 下 git diff 的输出。绝对路径不在 cwd 之内就原样返回。
export function normalizeFilePath(filePath: string): string {
  const fs = getFsImplementation()
  const cwd = getAttributionRepoRoot()

  if (!isAbsolute(filePath)) {
    return filePath
  }

  // Resolve symlinks in both paths for consistent comparison
  // (e.g., /tmp -> /private/tmp on macOS)
  let resolvedPath = filePath
  let resolvedCwd = cwd

  try {
    resolvedPath = fs.realpathSync(filePath)
  } catch {
    // File may not exist yet, use original path
  }

  try {
    resolvedCwd = fs.realpathSync(cwd)
  } catch {
    // Keep original cwd
  }

  if (
    resolvedPath.startsWith(resolvedCwd + sep) ||
    resolvedPath === resolvedCwd
  ) {
    // Normalize to forward slashes so keys match git diff output on Windows
    return relative(resolvedCwd, resolvedPath).replaceAll(sep, '/')
  }

  // Fallback: try original comparison
  if (filePath.startsWith(cwd + sep) || filePath === cwd) {
    return relative(cwd, filePath).replaceAll(sep, '/')
  }

  return filePath
}

/**
 * Expand a relative path to absolute path.
 */
// 把相对路径展开成绝对路径：相对路径就拼上仓库根，绝对路径原样返回。
export function expandFilePath(filePath: string): string {
  if (isAbsolute(filePath)) {
    return filePath
  }
  return join(getAttributionRepoRoot(), filePath)
}

/**
 * Create an empty attribution state for a new session.
 */
// 为新会话造一份空的归因状态：各计数器归零、surface 取客户端 surface、基线为空。
export function createEmptyAttributionState(): AttributionState {
  return {
    fileStates: new Map(),
    sessionBaselines: new Map(),
    surface: getClientSurface(),
    startingHeadSha: null,
    promptCount: 0,
    promptCountAtLastCommit: 0,
    permissionPromptCount: 0,
    permissionPromptCountAtLastCommit: 0,
    escapeCount: 0,
    escapeCountAtLastCommit: 0,
  }
}

/**
 * Compute the character contribution for a file modification.
 * Returns the FileAttributionState to store, or null if tracking failed.
 */
// 算一次文件修改的字符级贡献：新建或整删时贡献等于内容长度；否则用「公共前缀 / 公共后缀」匹配找出真正改动的区段（这样「Esc」改成「esc」这种等长替换也能正确计量，而 Math.abs 差值会算成 0）。贡献累加到该文件已有状态上，算不出就返回 null。
function computeFileModificationState(
  existingFileStates: Map<string, FileAttributionState>,
  filePath: string,
  oldContent: string,
  newContent: string,
  mtime: number,
): FileAttributionState | null {
  const normalizedPath = normalizeFilePath(filePath)

  try {
    // Calculate Claude's character contribution
    let claudeContribution: number

    if (oldContent === '' || newContent === '') {
      // New file or full deletion - contribution is the content length
      claudeContribution =
        oldContent === '' ? newContent.length : oldContent.length
    } else {
      // Find actual changed region via common prefix/suffix matching.
      // This correctly handles same-length replacements (e.g., "Esc" → "esc")
      // where Math.abs(newLen - oldLen) would be 0.
      const minLen = Math.min(oldContent.length, newContent.length)
      let prefixEnd = 0
      while (
        prefixEnd < minLen &&
        oldContent[prefixEnd] === newContent[prefixEnd]
      ) {
        prefixEnd++
      }
      let suffixLen = 0
      while (
        suffixLen < minLen - prefixEnd &&
        oldContent[oldContent.length - 1 - suffixLen] ===
          newContent[newContent.length - 1 - suffixLen]
      ) {
        suffixLen++
      }
      const oldChangedLen = oldContent.length - prefixEnd - suffixLen
      const newChangedLen = newContent.length - prefixEnd - suffixLen
      claudeContribution = Math.max(oldChangedLen, newChangedLen)
    }

    // Get current file state if it exists
    const existingState = existingFileStates.get(normalizedPath)
    const existingContribution = existingState?.claudeContribution ?? 0

    return {
      contentHash: computeContentHash(newContent),
      claudeContribution: existingContribution + claudeContribution,
      mtime,
    }
  } catch (error) {
    logError(error as Error)
    return null
  }
}

/**
 * Get a file's modification time (mtimeMs), falling back to Date.now() if
 * the file doesn't exist. This is async so it can be precomputed before
 * entering a sync setAppState callback.
 */
// 取文件的 mtimeMs，文件不存在时退回 Date.now()：做成异步是为了能在进入同步的 setAppState 回调前预计算好。
export async function getFileMtime(filePath: string): Promise<number> {
  const normalizedPath = normalizeFilePath(filePath)
  const absPath = expandFilePath(normalizedPath)
  try {
    const stats = await stat(absPath)
    return stats.mtimeMs
  } catch {
    return Date.now()
  }
}

/**
 * Track a file modification by Claude.
 * Called after Edit/Write tool completes.
 */
// 追踪一次「Claude 改了文件」：在 Edit / Write 工具完成后调用，算出贡献后写进状态的 fileStates（不可变更新，复制整份 Map）。
export function trackFileModification(
  state: AttributionState,
  filePath: string,
  oldContent: string,
  newContent: string,
  _userModified: boolean,
  mtime: number = Date.now(),
): AttributionState {
  const normalizedPath = normalizeFilePath(filePath)
  const newFileState = computeFileModificationState(
    state.fileStates,
    filePath,
    oldContent,
    newContent,
    mtime,
  )
  if (!newFileState) {
    return state
  }

  const newFileStates = new Map(state.fileStates)
  newFileStates.set(normalizedPath, newFileState)

  logForDebugging(
    `Attribution: Tracked ${newFileState.claudeContribution} chars for ${normalizedPath}`,
  )

  return {
    ...state,
    fileStates: newFileStates,
  }
}

/**
 * Track a file creation by Claude (e.g., via bash command).
 * Used when Claude creates a new file through a non-tracked mechanism.
 */
// 追踪一次「Claude 建了文件」（如经 bash 命令）：本质上就是「从空内容变成新内容」的一次修改，直接复用 trackFileModification。
export function trackFileCreation(
  state: AttributionState,
  filePath: string,
  content: string,
  mtime: number = Date.now(),
): AttributionState {
  // A creation is simply a modification from empty to the new content
  return trackFileModification(state, filePath, '', content, false, mtime)
}

/**
 * Track a file deletion by Claude (e.g., via bash rm command).
 * Used when Claude deletes a file through a non-tracked mechanism.
 */
// 追踪一次「Claude 删了文件」（如经 bash rm）：删掉的字符数累加到该文件已有贡献上，已删文件的内容哈希记为空串。
export function trackFileDeletion(
  state: AttributionState,
  filePath: string,
  oldContent: string,
): AttributionState {
  const normalizedPath = normalizeFilePath(filePath)
  const existingState = state.fileStates.get(normalizedPath)
  const existingContribution = existingState?.claudeContribution ?? 0
  const deletedChars = oldContent.length

  const newFileState: FileAttributionState = {
    contentHash: '', // Empty hash for deleted files
    claudeContribution: existingContribution + deletedChars,
    mtime: Date.now(),
  }

  const newFileStates = new Map(state.fileStates)
  newFileStates.set(normalizedPath, newFileState)

  logForDebugging(
    `Attribution: Tracked deletion of ${normalizedPath} (${deletedChars} chars removed, total contribution: ${newFileState.claudeContribution})`,
  )

  return {
    ...state,
    fileStates: newFileStates,
  }
}

// --

/**
 * Track multiple file changes in bulk, mutating a single Map copy.
 * This avoids the O(n²) cost of copying the Map per file when processing
 * large git diffs (e.g., jj operations that touch hundreds of thousands of files).
 */
// 批量追踪多处文件改动：只复制一份 Map 然后逐文件原地改，避免处理超大 git diff（如 jj 一次动几十万个文件）时「每文件复制一次 Map」的 O(n²) 代价。
export function trackBulkFileChanges(
  state: AttributionState,
  changes: ReadonlyArray<{
    path: string
    type: 'modified' | 'created' | 'deleted'
    oldContent: string
    newContent: string
    mtime?: number
  }>,
): AttributionState {
  // Create ONE copy of the Map, then mutate it for each file
  const newFileStates = new Map(state.fileStates)

  for (const change of changes) {
    const mtime = change.mtime ?? Date.now()
    if (change.type === 'deleted') {
      const normalizedPath = normalizeFilePath(change.path)
      const existingState = newFileStates.get(normalizedPath)
      const existingContribution = existingState?.claudeContribution ?? 0
      const deletedChars = change.oldContent.length

      newFileStates.set(normalizedPath, {
        contentHash: '',
        claudeContribution: existingContribution + deletedChars,
        mtime,
      })

      logForDebugging(
        `Attribution: Tracked deletion of ${normalizedPath} (${deletedChars} chars removed, total contribution: ${existingContribution + deletedChars})`,
      )
    } else {
      const newFileState = computeFileModificationState(
        newFileStates,
        change.path,
        change.oldContent,
        change.newContent,
        mtime,
      )
      if (newFileState) {
        const normalizedPath = normalizeFilePath(change.path)
        newFileStates.set(normalizedPath, newFileState)

        logForDebugging(
          `Attribution: Tracked ${newFileState.claudeContribution} chars for ${normalizedPath}`,
        )
      }
    }
  }

  return {
    ...state,
    fileStates: newFileStates,
  }
}

/**
 * Calculate final attribution for staged files.
 * Compares session baseline to committed state.
 */
// 计算「暂存文件」的最终归因：把多个会话的状态合并（基线取最早、贡献累加），再并行处理每个暂存文件——跳过生成文件、删除文件区分 Claude 删还是人类删、未追踪的修改按 git diff 大小估算人类字符；最后算出每文件明细、总量、Claude 占比、按 surface 的构成分解。
export async function calculateCommitAttribution(
  states: AttributionState[],
  stagedFiles: string[],
): Promise<AttributionData> {
  const cwd = getAttributionRepoRoot()
  const sessionId = getSessionId()

  const files: Record<string, FileAttribution> = {}
  const excludedGenerated: string[] = []
  const surfaces = new Set<string>()
  const surfaceCounts: Record<string, number> = {}

  let totalClaudeChars = 0
  let totalHumanChars = 0

  // Merge file states from all sessions
  const mergedFileStates = new Map<string, FileAttributionState>()
  const mergedBaselines = new Map<
    string,
    { contentHash: string; mtime: number }
  >()

  for (const state of states) {
    surfaces.add(state.surface)

    // Merge baselines (earliest baseline wins)
    // Handle both Map and plain object (in case of serialization)
    const baselines =
      state.sessionBaselines instanceof Map
        ? state.sessionBaselines
        : new Map(
            Object.entries(
              (state.sessionBaselines ?? {}) as Record<
                string,
                { contentHash: string; mtime: number }
              >,
            ),
          )
    for (const [path, baseline] of baselines) {
      if (!mergedBaselines.has(path)) {
        mergedBaselines.set(path, baseline)
      }
    }

    // Merge file states (accumulate contributions)
    // Handle both Map and plain object (in case of serialization)
    const fileStates =
      state.fileStates instanceof Map
        ? state.fileStates
        : new Map(
            Object.entries(
              (state.fileStates ?? {}) as Record<string, FileAttributionState>,
            ),
          )
    for (const [path, fileState] of fileStates) {
      const existing = mergedFileStates.get(path)
      if (existing) {
        mergedFileStates.set(path, {
          ...fileState,
          claudeContribution:
            existing.claudeContribution + fileState.claudeContribution,
        })
      } else {
        mergedFileStates.set(path, fileState)
      }
    }
  }

  // Process files in parallel
  const fileResults = await Promise.all(
    stagedFiles.map(async file => {
      // Skip generated files
      if (isGeneratedFile(file)) {
        return { type: 'generated' as const, file }
      }

      const absPath = join(cwd, file)
      const fileState = mergedFileStates.get(file)
      const baseline = mergedBaselines.get(file)

      // Get the surface for this file
      const fileSurface = states[0]!.surface

      let claudeChars = 0
      let humanChars = 0

      // Check if file was deleted
      const deleted = await isFileDeleted(file)

      if (deleted) {
        // File was deleted
        if (fileState) {
          // Claude deleted this file (tracked deletion)
          claudeChars = fileState.claudeContribution
          humanChars = 0
        } else {
          // Human deleted this file (untracked deletion)
          // Use diff size to get the actual change size
          const diffSize = await getGitDiffSize(file)
          humanChars = diffSize > 0 ? diffSize : 100 // Minimum attribution for a deletion
        }
      } else {
        try {
          // Only need file size, not content - stat() avoids loading GB-scale
          // build artifacts into memory when they appear in the working tree.
          // stats.size (bytes) is an adequate proxy for char count here.
          const stats = await stat(absPath)

          if (fileState) {
            // We have tracked modifications for this file
            claudeChars = fileState.claudeContribution
            humanChars = 0
          } else if (baseline) {
            // File was modified but not tracked - human modification
            const diffSize = await getGitDiffSize(file)
            humanChars = diffSize > 0 ? diffSize : stats.size
          } else {
            // New file not created by Claude
            humanChars = stats.size
          }
        } catch {
          // File doesn't exist or stat failed - skip it
          return null
        }
      }

      // Ensure non-negative values
      claudeChars = Math.max(0, claudeChars)
      humanChars = Math.max(0, humanChars)

      const total = claudeChars + humanChars
      const percent = total > 0 ? Math.round((claudeChars / total) * 100) : 0

      return {
        type: 'file' as const,
        file,
        claudeChars,
        humanChars,
        percent,
        surface: fileSurface,
      }
    }),
  )

  // Aggregate results
  for (const result of fileResults) {
    if (!result) continue

    if (result.type === 'generated') {
      excludedGenerated.push(result.file)
      continue
    }

    files[result.file] = {
      claudeChars: result.claudeChars,
      humanChars: result.humanChars,
      percent: result.percent,
      surface: result.surface,
    }

    totalClaudeChars += result.claudeChars
    totalHumanChars += result.humanChars

    surfaceCounts[result.surface] =
      (surfaceCounts[result.surface] ?? 0) + result.claudeChars
  }

  const totalChars = totalClaudeChars + totalHumanChars
  const claudePercent =
    totalChars > 0 ? Math.round((totalClaudeChars / totalChars) * 100) : 0

  // Calculate surface breakdown (percentage of total content per surface)
  const surfaceBreakdown: Record<
    string,
    { claudeChars: number; percent: number }
  > = {}
  for (const [surface, chars] of Object.entries(surfaceCounts)) {
    // Calculate what percentage of TOTAL content this surface contributed
    const percent = totalChars > 0 ? Math.round((chars / totalChars) * 100) : 0
    surfaceBreakdown[surface] = { claudeChars: chars, percent }
  }

  return {
    version: 1,
    summary: {
      claudePercent,
      claudeChars: totalClaudeChars,
      humanChars: totalHumanChars,
      surfaces: Array.from(surfaces),
    },
    files,
    surfaceBreakdown,
    excludedGenerated,
    sessions: [sessionId],
  }
}

/**
 * Get the size of changes for a file from git diff.
 * Returns the number of characters added/removed (absolute difference).
 * For new files, returns the total file size.
 * For deleted files, returns the size of the deleted content.
 */
// 从 git diff 估算一个文件的改动字符数：用 git diff --cached --stat 抓摘要，对「N files changed, X insertions, Y deletions」这类汇总行，把插入 + 删除的行数乘以约 40（每行平均字符）当作字符数。
export async function getGitDiffSize(filePath: string): Promise<number> {
  const cwd = getAttributionRepoRoot()

  try {
    // Use git diff --stat to get a summary of changes
    const result = await execFileNoThrowWithCwd(
      gitExe(),
      ['diff', '--cached', '--stat', '--', filePath],
      { cwd, timeout: 5000 },
    )

    if (result.code !== 0 || !result.stdout) {
      return 0
    }

    // Parse the stat output to extract additions and deletions
    // Format: " file | 5 ++---" or " file | 10 +"
    const lines = result.stdout.split('\n').filter(Boolean)
    let totalChanges = 0

    for (const line of lines) {
      // Skip the summary line (e.g., "1 file changed, 3 insertions(+), 2 deletions(-)")
      if (line.includes('file changed') || line.includes('files changed')) {
        const insertMatch = line.match(/(\d+) insertions?/)
        const deleteMatch = line.match(/(\d+) deletions?/)

        // Use line-based changes and approximate chars per line (~40 chars average)
        const insertions = insertMatch ? parseInt(insertMatch[1]!, 10) : 0
        const deletions = deleteMatch ? parseInt(deleteMatch[1]!, 10) : 0
        totalChanges += (insertions + deletions) * 40
      }
    }

    return totalChanges
  } catch {
    return 0
  }
}

/**
 * Check if a file was deleted in the staged changes.
 */
// 判断一个文件在暂存改动里是否被删：用 git diff --cached --name-status 看输出是不是以 D 加制表符开头。
export async function isFileDeleted(filePath: string): Promise<boolean> {
  const cwd = getAttributionRepoRoot()

  try {
    const result = await execFileNoThrowWithCwd(
      gitExe(),
      ['diff', '--cached', '--name-status', '--', filePath],
      { cwd, timeout: 5000 },
    )

    if (result.code === 0 && result.stdout) {
      // Format: "D\tfilename" for deleted files
      return result.stdout.trim().startsWith('D\t')
    }
  } catch {
    // Ignore errors
  }

  return false
}

/**
 * Get staged files from git.
 */
// 取当前暂存的文件列表：git diff --cached --name-only，出错的按空列表处理。
export async function getStagedFiles(): Promise<string[]> {
  const cwd = getAttributionRepoRoot()

  try {
    const result = await execFileNoThrowWithCwd(
      gitExe(),
      ['diff', '--cached', '--name-only'],
      { cwd, timeout: 5000 },
    )

    if (result.code === 0 && result.stdout) {
      return result.stdout.split('\n').filter(Boolean)
    }
  } catch (error) {
    logError(error as Error)
  }

  return []
}

// formatAttributionTrailer moved to attributionTrailer.ts for tree-shaking
// (contains excluded strings that should not be in external builds)

/**
 * Check if we're in a transient git state (rebase, merge, cherry-pick).
 */
// 判断 git 是否处于「瞬态」：rebase / merge / cherry-pick / bisect 进行中（通过检查 .git 下的 rebase-merge、MERGE_HEAD、CHERRY_PICK_HEAD、BISECT_LOG 这些标记文件是否存在）。
export async function isGitTransientState(): Promise<boolean> {
  const gitDir = await resolveGitDir(getAttributionRepoRoot())
  if (!gitDir) return false

  const indicators = [
    'rebase-merge',
    'rebase-apply',
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'BISECT_LOG',
  ]

  const results = await Promise.all(
    indicators.map(async indicator => {
      try {
        await stat(join(gitDir, indicator))
        return true
      } catch {
        return false
      }
    }),
  )

  return results.some(exists => exists)
}

/**
 * Convert attribution state to snapshot message for persistence.
 */
// 把归因状态序列化成「快照消息」以便持久化：把 Map 形式的 fileStates 摊平成普通对象，连同各类计数器一起打包成 attribution-snapshot 消息。
export function stateToSnapshotMessage(
  state: AttributionState,
  messageId: UUID,
): AttributionSnapshotMessage {
  const fileStates: Record<string, FileAttributionState> = {}

  for (const [path, fileState] of state.fileStates) {
    fileStates[path] = fileState
  }

  return {
    type: 'attribution-snapshot',
    messageId,
    surface: state.surface,
    fileStates,
    promptCount: state.promptCount,
    promptCountAtLastCommit: state.promptCountAtLastCommit,
    permissionPromptCount: state.permissionPromptCount,
    permissionPromptCountAtLastCommit: state.permissionPromptCountAtLastCommit,
    escapeCount: state.escapeCount,
    escapeCountAtLastCommit: state.escapeCountAtLastCommit,
  }
}

/**
 * Restore attribution state from snapshot messages.
 */
// 从快照消息恢复归因状态：快照是「整份状态」而非增量，最后一个快照对每个路径都持有最新计数（fileStates 只会增长）。注释里特意点出——若跨所有快照把计数累加会二次方膨胀（837 个快照 × 280 文件会算成 1.15 千万亿「字符」），所以这里只取最后一个快照。
export function restoreAttributionStateFromSnapshots(
  snapshots: AttributionSnapshotMessage[],
): AttributionState {
  const state = createEmptyAttributionState()

  // Snapshots are full-state dumps (see stateToSnapshotMessage), not deltas.
  // The last snapshot has the most recent count for every path — fileStates
  // never shrinks. Iterating and SUMMING counts across snapshots causes
  // quadratic growth on restore (837 snapshots × 280 files → 1.15 quadrillion
  // "chars" tracked for a 5KB file over a 5-day session).
  const lastSnapshot = snapshots[snapshots.length - 1]
  if (!lastSnapshot) {
    return state
  }

  state.surface = lastSnapshot.surface
  for (const [path, fileState] of Object.entries(lastSnapshot.fileStates)) {
    state.fileStates.set(path, fileState)
  }

  // Restore prompt counts from the last snapshot (most recent state)
  state.promptCount = lastSnapshot.promptCount ?? 0
  state.promptCountAtLastCommit = lastSnapshot.promptCountAtLastCommit ?? 0
  state.permissionPromptCount = lastSnapshot.permissionPromptCount ?? 0
  state.permissionPromptCountAtLastCommit =
    lastSnapshot.permissionPromptCountAtLastCommit ?? 0
  state.escapeCount = lastSnapshot.escapeCount ?? 0
  state.escapeCountAtLastCommit = lastSnapshot.escapeCountAtLastCommit ?? 0

  return state
}

/**
 * Restore attribution state from log snapshots on session resume.
 */
// 会话恢复时从日志快照重建归因状态：调上面的恢复函数再回调 onUpdateState 把新状态推出去。
export function attributionRestoreStateFromLog(
  attributionSnapshots: AttributionSnapshotMessage[],
  onUpdateState: (newState: AttributionState) => void,
): void {
  const state = restoreAttributionStateFromSnapshots(attributionSnapshots)
  onUpdateState(state)
}

/**
 * Increment promptCount and save an attribution snapshot.
 * Used to persist the prompt count across compaction.
 *
 * @param attribution - Current attribution state
 * @param saveSnapshot - Function to save the snapshot (allows async handling by caller)
 * @returns New attribution state with incremented promptCount
 */
// 递增 promptCount 并保存一份归因快照：用于在压缩（compaction）之间跨轮持久化提示计数；先复制状态把 promptCount +1，再生成快照交给调用方异步保存。
export function incrementPromptCount(
  attribution: AttributionState,
  saveSnapshot: (snapshot: AttributionSnapshotMessage) => void,
): AttributionState {
  const newAttribution = {
    ...attribution,
    promptCount: attribution.promptCount + 1,
  }
  const snapshot = stateToSnapshotMessage(newAttribution, randomUUID())
  saveSnapshot(snapshot)
  return newAttribution
}
