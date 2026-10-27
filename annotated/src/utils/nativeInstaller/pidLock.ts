/**
 * PID-Based Version Locking
 *
 * This module provides PID-based locking for running Claude Code versions.
 * Unlike mtime-based locking (which can hold locks for 30 days after a crash),
 * PID-based locking can immediately detect when a process is no longer running.
 *
 * Lock files contain JSON with the PID and metadata, and staleness is determined
 * by checking if the process is still alive.
 */
// 文件级：本文件实现基于 PID 的版本锁，用来标记当前正在运行的 Claude Code 版本。相比基于修改时间的锁（崩溃后可能锁 30 天），PID 锁能立刻发现进程是否已不在运行，锁文件里存 PID 与元数据，陈旧与否由进程是否还活着判定。

import { basename, join } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { logForDebugging } from '../debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { isENOENT, toError } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { getProcessCommand } from '../genericProcessUtils.js'
import { logError } from '../log.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../slowOperations.js'

/**
 * Check if PID-based version locking is enabled.
 * When disabled, falls back to mtime-based locking (30-day timeout).
 *
 * Controlled by GrowthBook gate with local override:
 * - Set ENABLE_PID_BASED_VERSION_LOCKING=true to force-enable
 * - Set ENABLE_PID_BASED_VERSION_LOCKING=false to force-disable
 * - If unset, GrowthBook gate (tengu_pid_based_version_locking) controls rollout
 */
// `isPidBasedLockingEnabled`：判断 PID 锁是否启用，环境变量可强制开/关，未设则由 GrowthBook 灰度开关决定（外部用户默认关）。
export function isPidBasedLockingEnabled(): boolean {
  const envVar = process.env.ENABLE_PID_BASED_VERSION_LOCKING
  // If env var is explicitly set, respect it
  if (isEnvTruthy(envVar)) {
// 环境变量显式为真就强制启用。
    return true
  }
  if (isEnvDefinedFalsy(envVar)) {
    return false
  }
  // GrowthBook controls gradual rollout (returns false for external users)
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_pid_based_version_locking',
    false,
  )
// 环境变量未设时回落到 GrowthBook 灰度开关，默认关闭。
}

/**
 * Content stored in a version lock file
 */
export type VersionLockContent = {
  pid: number
  version: string
  execPath: string
  acquiredAt: number // timestamp when lock was acquired
}
// `VersionLockContent`：锁文件 JSON 内容，含 PID、版本名、可执行路径与加锁时间戳。

/**
 * Information about a lock for diagnostic purposes
 */
export type LockInfo = {
  version: string
  pid: number
  isProcessRunning: boolean
  execPath: string
  acquiredAt: Date
  lockFilePath: string
}
// `LockInfo`：用于诊断的锁信息，在 `VersionLockContent` 基础上加上进程是否存活与锁文件路径。

// Fallback stale timeout (2 hours) - used when PID check is inconclusive
// This is much shorter than the previous 30-day timeout but still allows
// for edge cases like network filesystems where PID check might fail
const FALLBACK_STALE_MS = 2 * 60 * 60 * 1000
// `FALLBACK_STALE_MS`：当 PID 检查无法定论时的兜底陈旧阈值 2 小时，远短于旧的 30 天，但能容纳网络文件系统等边缘情形。

/**
 * Check if a process with the given PID is currently running
 * Uses signal 0 which doesn't actually send a signal but checks if we can
 */
// `isProcessRunning`：用信号 0（`process.kill(pid, 0)`）探测进程是否存活，不真正发信号只做权限检查。
export function isProcessRunning(pid: number): boolean {
  // PID 0 is special - it refers to the current process group, not a real process
  // PID 1 is init/systemd and is always running but shouldn't be considered for locks
  if (pid <= 1) {
// PID 0 与 1 是特殊值（进程组 / init），不用于锁判定，直接视为未运行。
    return false
  }

  try {
    process.kill(pid, 0)
// 用 `process.kill(pid, 0)` 试探，能发信号说明进程在，抛错说明已退出。
    return true
  } catch {
    return false
  }
}

/**
 * Validate that a running process is actually a Claude process
 * This helps mitigate PID reuse issues
 */
// `isClaudeProcess`：进一步确认运行中的进程确实是 Claude，缓解 PID 复用问题。
function isClaudeProcess(pid: number, expectedExecPath: string): boolean {
  if (!isProcessRunning(pid)) {
    return false
  }

  // If the PID matches our current process, we know it's valid
  // This handles test environments where the command might not contain 'claude'
  if (pid === process.pid) {
// PID 就是当前进程时直接认可信，覆盖测试环境里命令不含 `claude` 字样的情况。
    return true
  }

  try {
    const command = getProcessCommand(pid)
    if (!command) {
      // If we can't get the command, trust the PID check
      // This is conservative - we'd rather not delete a running version
      return true
    }

    // Check if the command contains 'claude' or the expected exec path
// 取进程命令做二次校验：命令含 `claude` 或期望的可执行路径才认定为 Claude 进程。
    const normalizedCommand = command.toLowerCase()
    const normalizedExecPath = expectedExecPath.toLowerCase()

    return (
      normalizedCommand.includes('claude') ||
      normalizedCommand.includes(normalizedExecPath)
    )
// 取不到命令或检查失败时保守地信任 PID 检查，宁可不动正在运行的版本。
  } catch {
    // If command check fails, trust the PID check
    return true
  }
}

/**
 * Read and parse a lock file's content
 */
// `readLockContent`：同步读并解析锁文件，内容为空格、字段缺失或解析失败都返回 `null`。
export function readLockContent(
  lockFilePath: string,
): VersionLockContent | null {
  const fs = getFsImplementation()

  try {
    const content = fs.readFileSync(lockFilePath, { encoding: 'utf8' })
// 用同步读文件拿到锁内容，空内容按无效处理。
    if (!content || content.trim() === '') {
      return null
    }

    const parsed = jsonParse(content) as VersionLockContent
// 解析 JSON 成锁内容结构。

    // Validate required fields
    if (typeof parsed.pid !== 'number' || !parsed.version || !parsed.execPath) {
// 校验必要字段（PID 为数字、版本与路径非空），缺任一即视为无效。
      return null
    }

    return parsed
  } catch {
    return null
  }
}

/**
 * Check if a lock file represents an active lock (process still running)
 */
// `isLockActive`：综合判断锁是否仍有效——进程在运行且确为 Claude 进程，过老且无法复核时才谨慎判陈旧。
export function isLockActive(lockFilePath: string): boolean {
  const content = readLockContent(lockFilePath)

  if (!content) {
    return false
  }

  const { pid, execPath } = content

  // Primary check: is the process running?
  if (!isProcessRunning(pid)) {
// 主检查：进程已不在运行就判定锁失效。
    return false
  }

  // Secondary validation: is it actually a Claude process?
  // This helps with PID reuse scenarios
  if (!isClaudeProcess(pid, execPath)) {
// 次检查：进程在但命令不像 Claude，按 PID 复用场景判为陈旧。
    logForDebugging(
      `Lock PID ${pid} is running but does not appear to be Claude - treating as stale`,
    )
    return false
  }

  // Fallback: if the lock is very old (> 2 hours) and we can't validate
  // the command, be conservative and consider it potentially stale
  // This handles edge cases like network filesystems
  const fs = getFsImplementation()
// 兜底：锁超过 2 小时且无法验证命令时，再次确认进程是否还在，避免误删。
  try {
    const stats = fs.statSync(lockFilePath)
    const age = Date.now() - stats.mtimeMs
    if (age > FALLBACK_STALE_MS) {
      // Double-check that we can still see the process
      if (!isProcessRunning(pid)) {
        return false
      }
    }
  } catch {
    // If we can't stat the file, trust the PID check
  }

  return true
}

/**
 * Write lock content to a file atomically
 */
// `writeLockFile`：原子写锁文件，先写带 PID 与时间戳的临时文件再重命名覆盖。
function writeLockFile(
  lockFilePath: string,
  content: VersionLockContent,
): void {
  const fs = getFsImplementation()
  const tempPath = `${lockFilePath}.tmp.${process.pid}.${Date.now()}`
// 临时文件名拼上本进程 PID 与当前时间，避免并发冲突。

  try {
    writeFileSync_DEPRECATED(tempPath, jsonStringify(content, null, 2), {
      encoding: 'utf8',
      flush: true,
    })
    fs.renameSync(tempPath, lockFilePath)
// 重命名完成原子替换，失败时删临时文件并向上抛错。
  } catch (error) {
    // Clean up temp file on failure (best-effort)
    try {
      fs.unlinkSync(tempPath)
    } catch {
      // Ignore cleanup errors (ENOENT expected if write failed before file creation)
    }
    throw error
  }
}

/**
 * Try to acquire a lock on a version file
 * Returns a release function if successful, null if the lock is already held
 */
// `tryAcquireLock`：尝试抢锁，成功返回释放函数、被占用返回 `null`；写入后会再读回验证，处理竞态下被别的进程抢先的情况。
export async function tryAcquireLock(
  versionPath: string,
  lockFilePath: string,
): Promise<(() => void) | null> {
  const fs = getFsImplementation()
  const versionName = basename(versionPath)

  // Check if there's an existing active lock (including by our own process)
  // Use isLockActive for consistency with cleanup - it checks both PID running AND
  // validates it's actually a Claude process (to handle PID reuse scenarios)
  if (isLockActive(lockFilePath)) {
// 抢锁前先看是否已有活跃锁（含本进程自己），活跃就记日志并返回 `null`。
    const existingContent = readLockContent(lockFilePath)
    logForDebugging(
      `Cannot acquire lock for ${versionName} - held by PID ${existingContent?.pid}`,
    )
    return null
  }

  // Try to acquire the lock
  const lockContent: VersionLockContent = {
    pid: process.pid,
    version: versionName,
    execPath: process.execPath,
    acquiredAt: Date.now(),
  }
// 组装锁内容：PID 用当前进程、版本名取目录基名、路径用 `process.execPath`、时间戳取当前。

  try {
    writeLockFile(lockFilePath, lockContent)

    // Verify we actually got the lock (race condition check)
    const verifyContent = readLockContent(lockFilePath)
// 写锁后读回验证 PID 是否还是自己，不是说明竞态输了，返回 `null`。
    if (verifyContent?.pid !== process.pid) {
      // Another process won the race
      return null
    }

    logForDebugging(`Acquired PID lock for ${versionName} (PID ${process.pid})`)

    // Return release function
    return () => {
      try {
        // Only release if we still own the lock
        const currentContent = readLockContent(lockFilePath)
        if (currentContent?.pid === process.pid) {
          fs.unlinkSync(lockFilePath)
          logForDebugging(`Released PID lock for ${versionName}`)
        }
      } catch (error) {
        logForDebugging(`Failed to release lock for ${versionName}: ${error}`)
      }
    }
// 返回的释放函数只在当前还持有锁（PID 仍为自己）时才删锁文件，避免误删他人锁。
  } catch (error) {
    logForDebugging(`Failed to acquire lock for ${versionName}: ${error}`)
    return null
  }
}

/**
 * Acquire a lock and hold it for the lifetime of the process
 * This is used for locking the currently running version
 */
// `acquireProcessLifetimeLock`：抢锁并持有到进程退出，注册 `exit`/`SIGINT`/`SIGTERM` 清理，用于锁住当前运行版本。
export async function acquireProcessLifetimeLock(
  versionPath: string,
  lockFilePath: string,
): Promise<boolean> {
  const release = await tryAcquireLock(versionPath, lockFilePath)

  if (!release) {
    return false
  }

  // Register cleanup on process exit
  const cleanup = () => {
    try {
      release()
    } catch {
      // Ignore errors during process exit
    }
  }

  process.on('exit', cleanup)
// 在进程退出与中断信号上挂清理，确保退出时释放锁。
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // Don't call release() - we want to hold the lock until process exits
  return true
}

/**
 * Execute a callback while holding a lock
 * Returns true if the callback executed, false if lock couldn't be acquired
 */
// `withLock`：在持锁状态下执行回调，抢不到锁返回 `false`，执行完或异常都 `finally` 释放锁。
export async function withLock(
  versionPath: string,
  lockFilePath: string,
  callback: () => void | Promise<void>,
): Promise<boolean> {
  const release = await tryAcquireLock(versionPath, lockFilePath)

  if (!release) {
    return false
  }

  try {
    await callback()
    return true
  } finally {
    release()
  }
}

/**
 * Get information about all version locks for diagnostics
 */
// `getAllLockInfo`：诊断用，列出目录下所有锁文件的信息（版本、PID、是否存活等）。
export function getAllLockInfo(locksDir: string): LockInfo[] {
  const fs = getFsImplementation()
  const lockInfos: LockInfo[] = []

  try {
    const lockFiles = fs
      .readdirStringSync(locksDir)
      .filter((f: string) => f.endsWith('.lock'))
// 过滤出 `.lock` 结尾的文件逐个读取。

    for (const lockFile of lockFiles) {
      const lockFilePath = join(locksDir, lockFile)
      const content = readLockContent(lockFilePath)

      if (content) {
// 能解析出内容的锁就收集其诊断信息。
        lockInfos.push({
          version: content.version,
          pid: content.pid,
          isProcessRunning: isProcessRunning(content.pid),
          execPath: content.execPath,
          acquiredAt: new Date(content.acquiredAt),
          lockFilePath,
        })
      }
    }
  } catch (error) {
    if (isENOENT(error)) {
      return lockInfos
    }
    logError(toError(error))
  }

  return lockInfos
}

/**
 * Clean up stale locks (locks where the process is no longer running)
 * Returns the number of locks cleaned up
 *
 * Handles both:
 * - PID-based locks (files containing JSON with PID)
 * - Legacy proper-lockfile locks (directories created by mtime-based locking)
 */
// `cleanupStaleLocks`：清理陈旧锁，返回清理数量；同时处理 PID 文件锁与旧的 proper-lockfile 目录锁两种形态。
export function cleanupStaleLocks(locksDir: string): number {
  const fs = getFsImplementation()
  let cleanedCount = 0

  try {
    const lockEntries = fs
      .readdirStringSync(locksDir)
      .filter((f: string) => f.endsWith('.lock'))

    for (const lockEntry of lockEntries) {
      const lockFilePath = join(locksDir, lockEntry)

      try {
        const stats = fs.lstatSync(lockFilePath)

        if (stats.isDirectory()) {
// 旧版目录锁（mtime 机制产生）在启用 PID 锁后一律递归删掉。
          // Legacy proper-lockfile directory lock - always remove when PID-based
          // locking is enabled since these are from a different locking mechanism
          fs.rmSync(lockFilePath, { recursive: true, force: true })
          cleanedCount++
          logForDebugging(`Cleaned up legacy directory lock: ${lockEntry}`)
        } else if (!isLockActive(lockFilePath)) {
// PID 文件锁若 `isLockActive` 判定失效（进程不在）就删除。
          // PID-based file lock with no running process
          fs.unlinkSync(lockFilePath)
          cleanedCount++
          logForDebugging(`Cleaned up stale lock: ${lockEntry}`)
        }
      } catch {
        // Ignore individual cleanup errors
      }
    }
  } catch (error) {
    if (isENOENT(error)) {
      return 0
    }
    logError(toError(error))
  }

  return cleanedCount
// 返回本次清理掉的锁数量。
}
