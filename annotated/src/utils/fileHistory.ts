import { createHash, type UUID } from 'crypto'
// 本模块实现「文件历史 / 检查点」：在每次文件编辑前给文件做个备份，从而可以把整个文件系统回滚到任意一条历史快照。核心设计：快照里只存「每个被追踪文件的某版本备份文件名」，备份实体放在配置目录下的 file-history 按会话分桶，从而支持会话续接时把旧会话的备份硬链接到新会话。
import { diffLines } from 'diff'
import type { Stats } from 'fs'
import {
  chmod,
  copyFile,
  link,
  mkdir,
  readFile,
  stat,
  unlink,
} from 'fs/promises'
import { dirname, isAbsolute, join, relative } from 'path'
import {
  getIsNonInteractiveSession,
  getOriginalCwd,
  getSessionId,
} from 'src/bootstrap/state.js'
import { logEvent } from 'src/services/analytics/index.js'
import { notifyVscodeFileUpdated } from 'src/services/mcp/vscodeSdkMcp.js'
import type { LogOption } from 'src/types/logs.js'
import { inspect } from 'util'
import { getGlobalConfig } from './config.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { getErrnoCode, isENOENT } from './errors.js'
import { pathExists } from './file.js'
import { logError } from './log.js'
import { recordFileHistorySnapshot } from './sessionStorage.js'

type BackupFileName = string | null // The null value means the file does not exist in this version
// BackupFileName 是 string 或 null：null 表示这个版本下该文件并不存在（文件删除也当作一种状态记录）。

export type FileHistoryBackup = {
  backupFileName: BackupFileName
  version: number
  backupTime: Date
}
// FileHistoryBackup 描述某文件在某快照里的一条备份：备份文件名、版本号、备份时间。

export type FileHistorySnapshot = {
  messageId: UUID // The associated message ID for this snapshot
  trackedFileBackups: Record<string, FileHistoryBackup> // Map of file paths to backup versions
  timestamp: Date
}
// FileHistorySnapshot 是一份快照：关联的消息 ID、被追踪文件的备份表、时间戳。

export type FileHistoryState = {
  snapshots: FileHistorySnapshot[]
  trackedFiles: Set<string>
  // Monotonically-increasing counter incremented on every snapshot, even when
  // old snapshots are evicted.  Used by useGitDiffStats as an activity signal
  // (snapshots.length plateaus once the cap is reached).
  snapshotSequence: number
}
// FileHistoryState 是运行时状态：快照数组、被追踪文件集合，以及一个只增不减的快照序列号（供 useGitDiffStats 当作活跃度信号，因为快照数到上限会平台化）。

const MAX_SNAPSHOTS = 100
// MAX_SNAPSHOTS = 100 是内存里保留的快照上限。
export type DiffStats =
  | {
      filesChanged?: string[]
      insertions: number
      deletions: number
    }
  | undefined
// DiffStats 是回滚到某快照时的影响统计：改了哪些文件、增删行数，或 undefined。

export function fileHistoryEnabled(): boolean {
// fileHistoryEnabled 判断是否启用文件历史：非交互会话走 SDK 开关；普通会话看全局配置与禁用环境变量，任一为真即开启。
  if (getIsNonInteractiveSession()) {
    return fileHistoryEnabledSdk()
  }
  return (
    getGlobalConfig().fileCheckpointingEnabled !== false &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING)
  )
}

function fileHistoryEnabledSdk(): boolean {
// fileHistoryEnabledSdk 是 SDK 模式下的专用开关，需显式启用且未被禁用。
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING) &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING)
  )
}

/**
 * Tracks a file edit (and add) by creating a backup of its current contents (if necessary).
 *
 * This must be called before the file is actually added or edited, so we can save
 * its contents before the edit.
 */
export async function fileHistoryTrackEdit(
  updateFileHistoryState: (
    updater: (prev: FileHistoryState) => FileHistoryState,
  ) => void,
  filePath: string,
  messageId: UUID,
): Promise<void> {
// fileHistoryTrackEdit 在「编辑或新增文件之前」调用：先给当前内容做个 v1 备份（若需要），并把文件登记进最近一份快照的追踪表。分三阶段：先无副作用地探一遍状态，再异步备份，最后在更新回调里提交，避免把确定性备份覆盖成编辑后的内容。
  if (!fileHistoryEnabled()) {
    return
  }

  const trackingPath = maybeShortenFilePath(filePath)

  // Phase 1: check if backup is needed. Speculative writes would overwrite
  // the deterministic {hash}@v1 backup on every repeat call — a second
  // trackEdit after an edit would corrupt v1 with post-edit content.
  let captured: FileHistoryState | undefined
  updateFileHistoryState(state => {
    captured = state
    return state
  })
  if (!captured) return
  const mostRecent = captured.snapshots.at(-1)
  if (!mostRecent) {
    logError(new Error('FileHistory: Missing most recent snapshot'))
    logEvent('tengu_file_history_track_edit_failed', {})
    return
  }
  if (mostRecent.trackedFileBackups[trackingPath]) {
    // Already tracked in the most recent snapshot; next makeSnapshot will
    // re-check mtime and re-backup if changed. Do not touch v1 backup.
    return
  }

  // Phase 2: async backup.
  let backup: FileHistoryBackup
  try {
    backup = await createBackup(filePath, 1)
  } catch (error) {
    logError(error)
    logEvent('tengu_file_history_track_edit_failed', {})
    return
  }
  const isAddingFile = backup.backupFileName === null

  // Phase 3: commit. Re-check tracked (another trackEdit may have raced).
  updateFileHistoryState((state: FileHistoryState) => {
    try {
      const mostRecentSnapshot = state.snapshots.at(-1)
      if (
        !mostRecentSnapshot ||
        mostRecentSnapshot.trackedFileBackups[trackingPath]
      ) {
        return state
      }

      // This file has not already been tracked in the most recent snapshot, so we
      // need to retroactively track a backup there.
      const updatedTrackedFiles = state.trackedFiles.has(trackingPath)
        ? state.trackedFiles
        : new Set(state.trackedFiles).add(trackingPath)

      // Shallow-spread is sufficient: backup values are never mutated after
      // insertion, so we only need fresh top-level + trackedFileBackups refs
      // for React change detection. A deep clone would copy every existing
      // backup's Date/string fields — O(n) cost to add one entry.
      const updatedMostRecentSnapshot = {
        ...mostRecentSnapshot,
        trackedFileBackups: {
          ...mostRecentSnapshot.trackedFileBackups,
          [trackingPath]: backup,
        },
      }

      const updatedState = {
        ...state,
        snapshots: (() => {
          const copy = state.snapshots.slice()
          copy[copy.length - 1] = updatedMostRecentSnapshot
          return copy
        })(),
        trackedFiles: updatedTrackedFiles,
      }
      maybeDumpStateForDebug(updatedState)

      // Record a snapshot update since it has changed.
      void recordFileHistorySnapshot(
        messageId,
        updatedMostRecentSnapshot,
        true, // isSnapshotUpdate
      ).catch(error => {
        logError(new Error(`FileHistory: Failed to record snapshot: ${error}`))
      })

      logEvent('tengu_file_history_track_edit_success', {
        isNewFile: isAddingFile,
        version: backup.version,
      })
      logForDebugging(`FileHistory: Tracked file modification for ${filePath}`)

      return updatedState
    } catch (error) {
      logError(error)
      logEvent('tengu_file_history_track_edit_failed', {})
      return state
    }
  })
}

/**
 * Adds a snapshot in the file history and backs up any modified tracked files.
 */
export async function fileHistoryMakeSnapshot(
  updateFileHistoryState: (
    updater: (prev: FileHistoryState) => FileHistoryState,
  ) => void,
  messageId: UUID,
// fileHistoryMakeSnapshot 在每次请求后做快照：给所有被追踪且内容变化的文件重新备份，提交一份新快照（超过 MAX_SNAPSHOTS 只保留最近 100 份）。同样分探状态、异步备份、提交三阶段，提交时把 trackEdit 阶段可能新增的文件也继承进来。
): Promise<void> {
  if (!fileHistoryEnabled()) {
    return undefined
  }

  // Phase 1: capture current state with a no-op updater so we know which
  // files to back up. Returning the same reference keeps this a true no-op
  // for any wrapper that honors same-ref returns (src/CLAUDE.md wrapper
  // rule). Wrappers that unconditionally spread will trigger one extra
  // re-render; acceptable for a once-per-turn call.
  let captured: FileHistoryState | undefined
  updateFileHistoryState(state => {
    captured = state
    return state
  })
  if (!captured) return // updateFileHistoryState was a no-op stub (e.g. mcp.ts)

  // Phase 2: do all IO async, outside the updater.
  const trackedFileBackups: Record<string, FileHistoryBackup> = {}
  const mostRecentSnapshot = captured.snapshots.at(-1)
  if (mostRecentSnapshot) {
    logForDebugging(`FileHistory: Making snapshot for message ${messageId}`)
    await Promise.all(
      Array.from(captured.trackedFiles, async trackingPath => {
        try {
          const filePath = maybeExpandFilePath(trackingPath)
          const latestBackup =
            mostRecentSnapshot.trackedFileBackups[trackingPath]
          const nextVersion = latestBackup ? latestBackup.version + 1 : 1

          // Stat the file once; ENOENT means the tracked file was deleted.
          let fileStats: Stats | undefined
          try {
            fileStats = await stat(filePath)
          } catch (e: unknown) {
            if (!isENOENT(e)) throw e
          }

          if (!fileStats) {
            trackedFileBackups[trackingPath] = {
              backupFileName: null, // Use null to denote missing tracked file
              version: nextVersion,
              backupTime: new Date(),
            }
            logEvent('tengu_file_history_backup_deleted_file', {
              version: nextVersion,
            })
            logForDebugging(
              `FileHistory: Missing tracked file: ${trackingPath}`,
            )
            return
          }

          // File exists - check if it needs to be backed up
          if (
            latestBackup &&
            latestBackup.backupFileName !== null &&
            !(await checkOriginFileChanged(
              filePath,
              latestBackup.backupFileName,
              fileStats,
            ))
          ) {
            // File hasn't been modified since the latest version, reuse it
            trackedFileBackups[trackingPath] = latestBackup
            return
          }

          // File is newer than the latest backup, create a new backup
          trackedFileBackups[trackingPath] = await createBackup(
            filePath,
            nextVersion,
          )
        } catch (error) {
          logError(error)
          logEvent('tengu_file_history_backup_file_failed', {})
        }
      }),
    )
  }

  // Phase 3: commit the new snapshot to state. Read state.trackedFiles FRESH
  // — if fileHistoryTrackEdit added a file during phase 2's async window, it
  // wrote the backup to state.snapshots[-1].trackedFileBackups. Inherit those
  // so the new snapshot covers every currently-tracked file.
  updateFileHistoryState((state: FileHistoryState) => {
    try {
      const lastSnapshot = state.snapshots.at(-1)
      if (lastSnapshot) {
        for (const trackingPath of state.trackedFiles) {
          if (trackingPath in trackedFileBackups) continue
          const inherited = lastSnapshot.trackedFileBackups[trackingPath]
          if (inherited) trackedFileBackups[trackingPath] = inherited
        }
      }
      const now = new Date()
      const newSnapshot: FileHistorySnapshot = {
        messageId,
        trackedFileBackups,
        timestamp: now,
      }

      const allSnapshots = [...state.snapshots, newSnapshot]
      const updatedState: FileHistoryState = {
        ...state,
        snapshots:
          allSnapshots.length > MAX_SNAPSHOTS
            ? allSnapshots.slice(-MAX_SNAPSHOTS)
            : allSnapshots,
        snapshotSequence: (state.snapshotSequence ?? 0) + 1,
      }
      maybeDumpStateForDebug(updatedState)

      void notifyVscodeSnapshotFilesUpdated(state, updatedState).catch(logError)

      // Record the file history snapshot to session storage for resume support
      void recordFileHistorySnapshot(
        messageId,
        newSnapshot,
        false, // isSnapshotUpdate
      ).catch(error => {
        logError(new Error(`FileHistory: Failed to record snapshot: ${error}`))
      })

      logForDebugging(
        `FileHistory: Added snapshot for ${messageId}, tracking ${state.trackedFiles.size} files`,
      )
      logEvent('tengu_file_history_snapshot_success', {
        trackedFilesCount: state.trackedFiles.size,
        snapshotCount: updatedState.snapshots.length,
      })

      return updatedState
    } catch (error) {
      logError(error)
      logEvent('tengu_file_history_snapshot_failed', {})
      return state
    }
  })
}

/**
 * Rewinds the file system to a previous snapshot.
 */
export async function fileHistoryRewind(
  updateFileHistoryState: (
    updater: (prev: FileHistoryState) => FileHistoryState,
  ) => void,
  messageId: UUID,
// fileHistoryRewind 把文件系统回滚到指定快照：纯文件副作用，不改 FileHistoryState；找到目标快照后调用 applySnapshot 写或删磁盘文件，失败抛错。
): Promise<void> {
  if (!fileHistoryEnabled()) {
    return
  }

  // Rewind is a pure filesystem side-effect and does not mutate
  // FileHistoryState. Capture state with a no-op updater, then do IO async.
  let captured: FileHistoryState | undefined
  updateFileHistoryState(state => {
    captured = state
    return state
  })
  if (!captured) return

  const targetSnapshot = captured.snapshots.findLast(
    snapshot => snapshot.messageId === messageId,
  )
  if (!targetSnapshot) {
    logError(new Error(`FileHistory: Snapshot for ${messageId} not found`))
    logEvent('tengu_file_history_rewind_failed', {
      trackedFilesCount: captured.trackedFiles.size,
      snapshotFound: false,
    })
    throw new Error('The selected snapshot was not found')
  }

  try {
    logForDebugging(
      `FileHistory: [Rewind] Rewinding to snapshot for ${messageId}`,
    )
    const filesChanged = await applySnapshot(captured, targetSnapshot)

    logForDebugging(`FileHistory: [Rewind] Finished rewinding to ${messageId}`)
    logEvent('tengu_file_history_rewind_success', {
      trackedFilesCount: captured.trackedFiles.size,
      filesChangedCount: filesChanged.length,
    })
  } catch (error) {
    logError(error)
    logEvent('tengu_file_history_rewind_failed', {
      trackedFilesCount: captured.trackedFiles.size,
      snapshotFound: true,
    })
    throw error
  }
}

export function fileHistoryCanRestore(
  state: FileHistoryState,
  messageId: UUID,
): boolean {
// fileHistoryCanRestore 判断某消息是否已有快照可恢复，供 UI 决定要不要展示回滚入口。
  if (!fileHistoryEnabled()) {
    return false
  }

  return state.snapshots.some(snapshot => snapshot.messageId === messageId)
}

/**
 * Computes diff stats for a file snapshot by counting the number of files that would be changed
 * if reverting to that snapshot.
 */
export async function fileHistoryGetDiffStats(
  state: FileHistoryState,
  messageId: UUID,
): Promise<DiffStats> {
// fileHistoryGetDiffStats 算「回滚到某快照会改多少」：对每个被追踪文件比较当前与快照备份，汇总增删行数与改动文件。
  if (!fileHistoryEnabled()) {
    return undefined
  }

  const targetSnapshot = state.snapshots.findLast(
    snapshot => snapshot.messageId === messageId,
  )

  if (!targetSnapshot) {
    return undefined
  }

  const results = await Promise.all(
    Array.from(state.trackedFiles, async trackingPath => {
      try {
        const filePath = maybeExpandFilePath(trackingPath)
        const targetBackup = targetSnapshot.trackedFileBackups[trackingPath]

        const backupFileName: BackupFileName | undefined = targetBackup
          ? targetBackup.backupFileName
          : getBackupFileNameFirstVersion(trackingPath, state)

        if (backupFileName === undefined) {
          // Error resolving the backup, so don't touch the file
          logError(
            new Error('FileHistory: Error finding the backup file to apply'),
          )
          logEvent('tengu_file_history_rewind_restore_file_failed', {
            dryRun: true,
          })
          return null
        }

        const stats = await computeDiffStatsForFile(
          filePath,
          backupFileName === null ? undefined : backupFileName,
        )
        if (stats?.insertions || stats?.deletions) {
          return { filePath, stats }
        }
        if (backupFileName === null && (await pathExists(filePath))) {
          // Zero-byte file created after snapshot: counts as changed even
          // though diffLines reports 0/0.
          return { filePath, stats }
        }
        return null
      } catch (error) {
        logError(error)
        logEvent('tengu_file_history_rewind_restore_file_failed', {
          dryRun: true,
        })
        return null
      }
    }),
  )

  const filesChanged: string[] = []
  let insertions = 0
  let deletions = 0
  for (const r of results) {
    if (!r) continue
    filesChanged.push(r.filePath)
    insertions += r.stats?.insertions || 0
    deletions += r.stats?.deletions || 0
  }
  return { filesChanged, insertions, deletions }
}

/**
 * Lightweight boolean-only check: would rewinding to this message change any
 * file on disk? Uses the same stat/content comparison as the non-dry-run path
 * of applySnapshot (checkOriginFileChanged) instead of computeDiffStatsForFile,
 * so it never calls diffLines. Early-exits on the first changed file. Use when
 * the caller only needs a yes/no answer; fileHistoryGetDiffStats remains for
 * callers that display insertions/deletions.
 */
export async function fileHistoryHasAnyChanges(
  state: FileHistoryState,
  messageId: UUID,
): Promise<boolean> {
// fileHistoryHasAnyChanges 是轻量布尔判断：只回答「回滚会不会动任何文件」，复用 checkOriginFileChanged 的 stat/内容比较而不调 diffLines，遇到第一个改动就提前返回，给只关心 yes/no 的调用方省开销。
  if (!fileHistoryEnabled()) {
    return false
  }

  const targetSnapshot = state.snapshots.findLast(
    snapshot => snapshot.messageId === messageId,
  )
  if (!targetSnapshot) {
    return false
  }

  for (const trackingPath of state.trackedFiles) {
    try {
      const filePath = maybeExpandFilePath(trackingPath)
      const targetBackup = targetSnapshot.trackedFileBackups[trackingPath]
      const backupFileName: BackupFileName | undefined = targetBackup
        ? targetBackup.backupFileName
        : getBackupFileNameFirstVersion(trackingPath, state)

      if (backupFileName === undefined) {
        continue
      }
      if (backupFileName === null) {
        // Backup says file did not exist; probe via stat (operate-then-catch).
        if (await pathExists(filePath)) return true
        continue
      }
      if (await checkOriginFileChanged(filePath, backupFileName)) return true
    } catch (error) {
      logError(error)
    }
  }
  return false
}

/**
 * Applies the given file snapshot state to the tracked files (writes/deletes
 * on disk), returning the list of changed file paths. Async IO only.
 */
async function applySnapshot(
  state: FileHistoryState,
  targetSnapshot: FileHistorySnapshot,
): Promise<string[]> {
// applySnapshot 把快照真正落到磁盘：对每个被追踪文件，按备份决定写回某版本、删除（快照里该文件不存在）还是跳过（内容没变），返回改动文件路径。
  const filesChanged: string[] = []
  for (const trackingPath of state.trackedFiles) {
    try {
      const filePath = maybeExpandFilePath(trackingPath)
      const targetBackup = targetSnapshot.trackedFileBackups[trackingPath]

      const backupFileName: BackupFileName | undefined = targetBackup
        ? targetBackup.backupFileName
        : getBackupFileNameFirstVersion(trackingPath, state)

      if (backupFileName === undefined) {
        // Error resolving the backup, so don't touch the file
        logError(
          new Error('FileHistory: Error finding the backup file to apply'),
        )
        logEvent('tengu_file_history_rewind_restore_file_failed', {
          dryRun: false,
        })
        continue
      }

      if (backupFileName === null) {
        // File did not exist at the target version; delete it if present.
        try {
          await unlink(filePath)
          logForDebugging(`FileHistory: [Rewind] Deleted ${filePath}`)
          filesChanged.push(filePath)
        } catch (e: unknown) {
          if (!isENOENT(e)) throw e
          // Already absent; nothing to do.
        }
        continue
      }

      // File should exist at a specific version. Restore only if it differs.
      if (await checkOriginFileChanged(filePath, backupFileName)) {
        await restoreBackup(filePath, backupFileName)
        logForDebugging(
          `FileHistory: [Rewind] Restored ${filePath} from ${backupFileName}`,
        )
        filesChanged.push(filePath)
      }
    } catch (error) {
      logError(error)
      logEvent('tengu_file_history_rewind_restore_file_failed', {
        dryRun: false,
      })
    }
  }
  return filesChanged
}

/**
 * Checks if the original file has been changed compared to the backup file.
 * Optionally reuses a pre-fetched stat for the original file (when the caller
 * already stat'd it to check existence, we avoid a second syscall).
 *
 * Exported for testing.
 */
export async function checkOriginFileChanged(
  originalFile: string,
  backupFileName: string,
  originalStatsHint?: Stats,
): Promise<boolean> {
// checkOriginFileChanged 比较原文件与备份是否不同：先做 stat 比较（权限、大小、修改时间），只有修改时间不早于备份时才比较内容，最后才读文件比对。可复用调用方已拿到的 stat 省一次系统调用。
  const backupPath = resolveBackupPath(backupFileName)

  let originalStats: Stats | null = originalStatsHint ?? null
  if (!originalStats) {
    try {
      originalStats = await stat(originalFile)
    } catch (e: unknown) {
      if (!isENOENT(e)) return true
    }
  }
  let backupStats: Stats | null = null
  try {
    backupStats = await stat(backupPath)
  } catch (e: unknown) {
    if (!isENOENT(e)) return true
  }

  return compareStatsAndContent(originalStats, backupStats, async () => {
    try {
      const [originalContent, backupContent] = await Promise.all([
        readFile(originalFile, 'utf-8'),
        readFile(backupPath, 'utf-8'),
      ])
      return originalContent !== backupContent
    } catch {
      // File deleted between stat and read -> treat as changed.
      return true
    }
  })
}

/**
 * Shared stat/content comparison logic for sync and async change checks.
 * Returns true if the file has changed relative to the backup.
 */
function compareStatsAndContent<T extends boolean | Promise<boolean>>(
  originalStats: Stats | null,
  backupStats: Stats | null,
  compareContent: () => T,
// compareStatsAndContent 是 stat/内容比较的共享逻辑：一方缺失即视为改了；都缺失视为没改；权限或大小不同即改；原文件 mtime 早于备份则没改；否则才比内容。
): T | boolean {
  // One exists, one missing -> changed
  if ((originalStats === null) !== (backupStats === null)) {
    return true
  }
  // Both missing -> no change
  if (originalStats === null || backupStats === null) {
    return false
  }

  // Check file stats like permission and file size
  if (
    originalStats.mode !== backupStats.mode ||
    originalStats.size !== backupStats.size
  ) {
    return true
  }

  // This is an optimization that depends on the correct setting of the modified
  // time. If the original file's modified time was before the backup time, then
  // we can skip the file content comparison.
  if (originalStats.mtimeMs < backupStats.mtimeMs) {
    return false
  }

  // Use the more expensive file content comparison. The callback handles its
  // own read errors — a try/catch here is dead for async callbacks anyway.
  return compareContent()
}

/**
 * Computes the number of lines changed in the diff.
 */
async function computeDiffStatsForFile(
  originalFile: string,
  backupFileName?: string,
): Promise<DiffStats> {
// computeDiffStatsForFile 用 diffLines 算出单文件增删行数，供回滚预览展示。
  const filesChanged: string[] = []
  let insertions = 0
  let deletions = 0
  try {
    const backupPath = backupFileName
      ? resolveBackupPath(backupFileName)
      : undefined

    const [originalContent, backupContent] = await Promise.all([
      readFileAsyncOrNull(originalFile),
      backupPath ? readFileAsyncOrNull(backupPath) : null,
    ])

    if (originalContent === null && backupContent === null) {
      return {
        filesChanged,
        insertions,
        deletions,
      }
    }

    filesChanged.push(originalFile)

    // Compute the diff
    const changes = diffLines(originalContent ?? '', backupContent ?? '')
    changes.forEach(c => {
      if (c.added) {
        insertions += c.count || 0
      }
      if (c.removed) {
        deletions += c.count || 0
      }
    })
  } catch (error) {
    logError(new Error(`FileHistory: Error generating diffStats: ${error}`))
  }

  return {
    filesChanged,
    insertions,
    deletions,
  }
}

function getBackupFileName(filePath: string, version: number): string {
// getBackupFileName 用文件路径的 sha256 前 16 位加版本号拼出确定性备份文件名，保证同一文件同版本文件名稳定。
  const fileNameHash = createHash('sha256')
    .update(filePath)
    .digest('hex')
    .slice(0, 16)
  return `${fileNameHash}@v${version}`
}

function resolveBackupPath(backupFileName: string, sessionId?: string): string {
// resolveBackupPath 把备份文件名解析成完整路径：配置目录/file-history/会话ID/文件名；不传会话 ID 就用当前会话。
  const configDir = getClaudeConfigHomeDir()
  return join(
    configDir,
    'file-history',
    sessionId || getSessionId(),
    backupFileName,
  )
}

/**
 * Creates a backup of the file at filePath. If the file does not exist
 * (ENOENT), records a null backup (file-did-not-exist marker). All IO is
 * async. Lazy mkdir: tries copyFile first, creates the directory on ENOENT.
 */
async function createBackup(
  filePath: string | null,
  version: number,
): Promise<FileHistoryBackup> {
// createBackup 给文件做备份：源文件缺失就记一条 null 备份（文件不存在标记）；否则用 copyFile 避免把整文件读进堆（旧方案对过大文件会 OOM），写完后保留原文件权限。懒建目录：先试 copyFile，ENOENT 再 mkdir 重试。
  if (filePath === null) {
    return { backupFileName: null, version, backupTime: new Date() }
  }

  const backupFileName = getBackupFileName(filePath, version)
  const backupPath = resolveBackupPath(backupFileName)

  // Stat first: if the source is missing, record a null backup and skip the
  // copy. Separates "source missing" from "backup dir missing" cleanly —
  // sharing a catch for both meant a file deleted between copyFile-success
  // and stat would leave an orphaned backup with a null state record.
  let srcStats: Stats
  try {
    srcStats = await stat(filePath)
  } catch (e: unknown) {
    if (isENOENT(e)) {
      return { backupFileName: null, version, backupTime: new Date() }
    }
    throw e
  }

  // copyFile preserves content and avoids reading the whole file into the JS
  // heap (which the previous readFileSync+writeFileSync pipeline did, OOMing
  // on large tracked files). Lazy mkdir: 99% of calls hit the fast path
  // (directory already exists); on ENOENT, mkdir then retry.
  try {
    await copyFile(filePath, backupPath)
  } catch (e: unknown) {
    if (!isENOENT(e)) throw e
    await mkdir(dirname(backupPath), { recursive: true })
    await copyFile(filePath, backupPath)
  }

  // Preserve file permissions on the backup.
  await chmod(backupPath, srcStats.mode)

  logEvent('tengu_file_history_backup_file_created', {
    version: version,
    fileSize: srcStats.size,
  })

  return {
    backupFileName,
    version,
    backupTime: new Date(),
  }
}

/**
 * Restores a file from its backup path with proper directory creation and permissions.
 * Lazy mkdir: tries copyFile first, creates the directory on ENOENT.
 */
async function restoreBackup(
  filePath: string,
  backupFileName: string,
): Promise<void> {
// restoreBackup 从备份恢复文件：先 stat 备份确认存在，懒建目标目录后 copyFile，再恢复权限。
  const backupPath = resolveBackupPath(backupFileName)

  // Stat first: if the backup is missing, log and bail before attempting
  // the copy. Separates "backup missing" from "destination dir missing".
  let backupStats: Stats
  try {
    backupStats = await stat(backupPath)
  } catch (e: unknown) {
    if (isENOENT(e)) {
      logEvent('tengu_file_history_rewind_restore_file_failed', {})
      logError(
        new Error(`FileHistory: [Rewind] Backup file not found: ${backupPath}`),
      )
      return
    }
    throw e
  }

  // Lazy mkdir: 99% of calls hit the fast path (destination dir exists).
  try {
    await copyFile(backupPath, filePath)
  } catch (e: unknown) {
    if (!isENOENT(e)) throw e
    await mkdir(dirname(filePath), { recursive: true })
    await copyFile(backupPath, filePath)
  }

  // Restore the file permissions
  await chmod(filePath, backupStats.mode)
}

/**
 * Gets the first (earliest) backup version for a file, used when rewinding
 * to a target backup point where the file has not been tracked yet.
 *
 * @returns The backup file name for the first version, or null if the file
 * did not exist in the first version, or undefined if we cannot find a
 * first version at all
 */
function getBackupFileNameFirstVersion(
  trackingPath: string,
  state: FileHistoryState,
): BackupFileName | undefined {
// getBackupFileNameFirstVersion 找某文件最早的 v1 备份文件名（或 null 表示首版就不存在，或 undefined 表示找不到首版），用于回滚到一个还没追踪该文件的检查点。
  for (const snapshot of state.snapshots) {
    const backup = snapshot.trackedFileBackups[trackingPath]
    if (backup !== undefined && backup.version === 1) {
      // This can be either a file name or null, with null meaning the file
      // did not exist in the first version.
      return backup.backupFileName
    }
  }

  // The undefined means there was an error resolving the first version.
  return undefined
}

/**
 * Use the relative path as the key to reduce session storage space for tracking.
 */
function maybeShortenFilePath(filePath: string): string {
// maybeShortenFilePath 用相对路径当追踪键以省空间：绝对路径且位于原始工作目录内就转成相对路径。
  if (!isAbsolute(filePath)) {
    return filePath
  }
  const cwd = getOriginalCwd()
  if (filePath.startsWith(cwd)) {
    return relative(cwd, filePath)
  }
  return filePath
}

function maybeExpandFilePath(filePath: string): string {
// maybeExpandFilePath 是上面的逆操作：相对路径拼回原始工作目录得到绝对路径。
  if (isAbsolute(filePath)) {
    return filePath
  }
  return join(getOriginalCwd(), filePath)
}

/**
 * Restores file history snapshot state for a given log option.
 */
export function fileHistoryRestoreStateFromLog(
  fileHistorySnapshots: FileHistorySnapshot[],
  onUpdateState: (newState: FileHistoryState) => void,
): void {
// fileHistoryRestoreStateFromLog 从日志里的快照重建内存状态：把绝对路径迁移成缩短后的相对路径，重建被追踪文件集合与快照数组。
  if (!fileHistoryEnabled()) {
    return
  }
  // Make a copy of the snapshots as we migrate from absolute path to
  // shortened relative tracking path.
  const snapshots: FileHistorySnapshot[] = []
  // Rebuild the tracked files from the snapshots
  const trackedFiles = new Set<string>()
  for (const snapshot of fileHistorySnapshots) {
    const trackedFileBackups: Record<string, FileHistoryBackup> = {}
    for (const [path, backup] of Object.entries(snapshot.trackedFileBackups)) {
      const trackingPath = maybeShortenFilePath(path)
      trackedFiles.add(trackingPath)
      trackedFileBackups[trackingPath] = backup
    }
    snapshots.push({
      ...snapshot,
      trackedFileBackups: trackedFileBackups,
    })
  }
  onUpdateState({
    snapshots: snapshots,
    trackedFiles: trackedFiles,
    snapshotSequence: snapshots.length,
  })
}

/**
 * Copy file history snapshots for a given log option.
 */
export async function copyFileHistoryForResume(log: LogOption): Promise<void> {
// copyFileHistoryForResume 在会话续接时把旧会话的备份硬链接（失败再拷贝）到新会话目录，使恢复能用上旧备份；按快照并行处理，只有全部备份迁移成功才记录该快照。
  if (!fileHistoryEnabled()) {
    return
  }

  const fileHistorySnapshots = log.fileHistorySnapshots
  if (!fileHistorySnapshots || log.messages.length === 0) {
    return
  }
  const lastMessage = log.messages[log.messages.length - 1]
  const previousSessionId = lastMessage?.sessionId
  if (!previousSessionId) {
    logError(
      new Error(
        `FileHistory: Failed to copy backups on restore (no previous session id)`,
      ),
    )
    return
  }

  const sessionId = getSessionId()
  if (previousSessionId === sessionId) {
    logForDebugging(
      `FileHistory: No need to copy file history for resuming with same session id: ${sessionId}`,
    )
    return
  }

  try {
    // All backups share the same directory: {configDir}/file-history/{sessionId}/
    // Create it once upfront instead of once per backup file
    const newBackupDir = join(
      getClaudeConfigHomeDir(),
      'file-history',
      sessionId,
    )
    await mkdir(newBackupDir, { recursive: true })

    // Migrate all backup files from the previous session to current session.
    // Process all snapshots in parallel; within each snapshot, links also run in parallel.
    let failedSnapshots = 0
    await Promise.allSettled(
      fileHistorySnapshots.map(async snapshot => {
        const backupEntries = Object.values(snapshot.trackedFileBackups).filter(
          (backup): backup is typeof backup & { backupFileName: string } =>
            backup.backupFileName !== null,
        )

        const results = await Promise.allSettled(
          backupEntries.map(async ({ backupFileName }) => {
            const oldBackupPath = resolveBackupPath(
              backupFileName,
              previousSessionId,
            )
            const newBackupPath = join(newBackupDir, backupFileName)

            try {
              await link(oldBackupPath, newBackupPath)
            } catch (e: unknown) {
              const code = getErrnoCode(e)
              if (code === 'EEXIST') {
                // Already migrated, skip
                return
              }
              if (code === 'ENOENT') {
                logError(
                  new Error(
                    `FileHistory: Failed to copy backup ${backupFileName} on restore (backup file does not exist in ${previousSessionId})`,
                  ),
                )
                throw e
              }
              logError(
                new Error(
                  `FileHistory: Error hard linking backup file from previous session`,
                ),
              )
              // Fallback to copy if hard link fails
              try {
                await copyFile(oldBackupPath, newBackupPath)
              } catch (copyErr) {
                logError(
                  new Error(
                    `FileHistory: Error copying over backup from previous session`,
                  ),
                )
                throw copyErr
              }
            }

            logForDebugging(
              `FileHistory: Copied backup ${backupFileName} from session ${previousSessionId} to ${sessionId}`,
            )
          }),
        )

        const copyFailed = results.some(r => r.status === 'rejected')

        // Record the snapshot only if we have successfully migrated the backup files
        if (!copyFailed) {
          void recordFileHistorySnapshot(
            snapshot.messageId,
            snapshot,
            false, // isSnapshotUpdate
          ).catch(_ => {
            logError(
              new Error(`FileHistory: Failed to record copy backup snapshot`),
            )
          })
        } else {
          failedSnapshots++
        }
      }),
    )

    if (failedSnapshots > 0) {
      logEvent('tengu_file_history_resume_copy_failed', {
        numSnapshots: fileHistorySnapshots.length,
        failedSnapshots,
      })
    }
  } catch (error) {
    logError(error)
  }
}

/**
 * Notifies VSCode about files that have changed between snapshots.
 * Compares the previous snapshot with the new snapshot and sends file_updated
 * notifications for any files whose content has changed.
 * Fire-and-forget (void-dispatched from fileHistoryMakeSnapshot).
 */
async function notifyVscodeSnapshotFilesUpdated(
  oldState: FileHistoryState,
  newState: FileHistoryState,
): Promise<void> {
// notifyVscodeSnapshotFilesUpdated 比较相邻两份快照，对在内容上有变化的文件向 VSCode 发 file_updated 通知（fire-and-forget），让编辑器刷新。
  const oldSnapshot = oldState.snapshots.at(-1)
  const newSnapshot = newState.snapshots.at(-1)

  if (!newSnapshot) {
    return
  }

  for (const trackingPath of newState.trackedFiles) {
    const filePath = maybeExpandFilePath(trackingPath)
    const oldBackup = oldSnapshot?.trackedFileBackups[trackingPath]
    const newBackup = newSnapshot.trackedFileBackups[trackingPath]

    // Skip if both backups reference the same version (no change)
    if (
      oldBackup?.backupFileName === newBackup?.backupFileName &&
      oldBackup?.version === newBackup?.version
    ) {
      continue
    }

    // Get old content from the previous backup
    let oldContent: string | null = null
    if (oldBackup?.backupFileName) {
      const backupPath = resolveBackupPath(oldBackup.backupFileName)
      oldContent = await readFileAsyncOrNull(backupPath)
    }

    // Get new content from the new backup or current file
    let newContent: string | null = null
    if (newBackup?.backupFileName) {
      const backupPath = resolveBackupPath(newBackup.backupFileName)
      newContent = await readFileAsyncOrNull(backupPath)
    }
    // If newBackup?.backupFileName === null, the file was deleted; newContent stays null.

    // Only notify if content actually changed
    if (oldContent !== newContent) {
      notifyVscodeFileUpdated(filePath, oldContent, newContent)
    }
  }
}

/** Async read that swallows all errors and returns null (best-effort). */
// readFileAsyncOrNull 是吞掉所有错误的异步读，读不到就返回 null，用于尽力而为的辅助读取。
async function readFileAsyncOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

const ENABLE_DUMP_STATE = false
// ENABLE_DUMP_STATE 默认关闭，maybeDumpStateForDebug 仅在开启时把状态 dump 出来便于调试。
function maybeDumpStateForDebug(state: FileHistoryState): void {
// maybeDumpStateForDebug 在开启调试开关时把文件历史状态打印出来。
  if (ENABLE_DUMP_STATE) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.error(inspect(state, false, 5))
  }
}
