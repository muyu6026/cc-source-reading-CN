// Scheduler lease lock for .claude/scheduled_tasks.json.
//
// When multiple Claude sessions run in the same project directory, only one
// should drive the cron scheduler. The first session to acquire this lock
// becomes the scheduler; others stay passive and periodically probe the lock.
// If the owner dies (PID no longer running), a passive session takes over.
//
// Pattern mirrors computerUseLock.ts: O_EXCL atomic create, PID liveness
// probe, stale-lock recovery, cleanup-on-exit.
// 文件总述：.claude/scheduled_tasks.json 的调度器租约锁。同一项目目录跑多个 Claude 会话时，只有一个会话应驱动 cron 调度器；首个拿到锁的成为调度器，其余被动轮询；拥有者进程死亡（PID 不再运行）时被动会话接管。模式照搬 computerUseLock.ts：O_EXCL 原子创建、PID 存活探测、陈旧锁恢复、退出清理。

import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { z } from 'zod/v4'
import { getProjectRoot, getSessionId } from '../bootstrap/state.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { getErrnoCode } from './errors.js'
import { isProcessRunning } from './genericProcessUtils.js'
import { safeParseJSON } from './json.js'
import { lazySchema } from './lazySchema.js'
import { jsonStringify } from './slowOperations.js'

const LOCK_FILE_REL = join('.claude', 'scheduled_tasks.lock')
// LOCK_FILE_REL：锁文件相对项目根的路径（.claude/scheduled_tasks.lock）。

const schedulerLockSchema = lazySchema(() =>
  z.object({
    sessionId: z.string(),
    pid: z.number(),
    acquiredAt: z.number(),
  }),
)
type SchedulerLock = z.infer<ReturnType<typeof schedulerLockSchema>>
// schedulerLockSchema 与 SchedulerLock 类型：用 zod 惰性 schema 描述锁内容（sessionId、pid、acquiredAt）。

/**
 * Options for out-of-REPL callers (Agent SDK daemon) that don't have
 * bootstrap state. When omitted, falls back to getProjectRoot() +
 * getSessionId() as before. lockIdentity should be stable for the lifetime
 * of one daemon process (e.g. a randomUUID() captured at startup).
 */
export type SchedulerLockOptions = {
  dir?: string
  lockIdentity?: string
}
// SchedulerLockOptions 类型：供没有 bootstrap 状态的调用方（Agent SDK 守护进程）传入目录与稳定锁身份。

let unregisterCleanup: (() => void) | undefined
// Suppress repeat "held by X" log lines when polling a live owner.
let lastBlockedBy: string | undefined

function getLockPath(dir?: string): string {
  return join(dir ?? getProjectRoot(), LOCK_FILE_REL)
}
// getLockPath：拼锁文件绝对路径，未提供目录时回退 getProjectRoot()。

async function readLock(dir?: string): Promise<SchedulerLock | undefined> {
  let raw: string
  try {
    raw = await readFile(getLockPath(dir), 'utf8')
  } catch {
    return undefined
  }
  const result = schedulerLockSchema().safeParse(safeParseJSON(raw, false))
  return result.success ? result.data : undefined
}
// readLock：读锁文件并校验 JSON，损坏或缺失返回 undefined。

async function tryCreateExclusive(
  lock: SchedulerLock,
  dir?: string,
): Promise<boolean> {
  const path = getLockPath(dir)
  const body = jsonStringify(lock)
  try {
    await writeFile(path, body, { flag: 'wx' })
    return true
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'EEXIST') return false
    if (code === 'ENOENT') {
      // .claude/ doesn't exist yet — create it and retry once. In steady
      // state the dir already exists (scheduled_tasks.json lives there),
      // so this path is hit at most once.
      await mkdir(dirname(path), { recursive: true })
      try {
        await writeFile(path, body, { flag: 'wx' })
        return true
      } catch (retryErr: unknown) {
        if (getErrnoCode(retryErr) === 'EEXIST') return false
        throw retryErr
      }
    }
    throw e
  }
}
// tryCreateExclusive：用 O_EXCL（flag wx）原子创建；EEXIST 表示已存在返回 false，ENOENT 时建目录重试一次。

function registerLockCleanup(opts?: SchedulerLockOptions): void {
  unregisterCleanup?.()
  unregisterCleanup = registerCleanup(async () => {
    await releaseSchedulerLock(opts)
  })
}
// registerLockCleanup：注册退出时释放锁的清理钩子（先注销旧的再注册新的）。

/**
 * Try to acquire the scheduler lock for the current session.
 * Returns true on success, false if another live session holds it.
 *
 * Uses O_EXCL ('wx') for atomic test-and-set. If the file exists:
 *   - Already ours → true (idempotent re-acquire)
 *   - Another live PID → false
 *   - Stale (PID dead / corrupt) → unlink and retry exclusive create once
 *
 * If two sessions race to recover a stale lock, only one create succeeds.
 */
export async function tryAcquireSchedulerLock(
// tryAcquireSchedulerLock 入口：尝试获取当前会话的调度器锁。
  opts?: SchedulerLockOptions,
): Promise<boolean> {
  const dir = opts?.dir
  // "sessionId" in the lock file is really just a stable owner key. REPL
  // uses getSessionId(); daemon callers supply their own UUID. PID remains
  // the liveness signal regardless.
  const sessionId = opts?.lockIdentity ?? getSessionId()
  const lock: SchedulerLock = {
    sessionId,
    pid: process.pid,
    acquiredAt: Date.now(),
  }

  if (await tryCreateExclusive(lock, dir)) {
    lastBlockedBy = undefined
    registerLockCleanup(opts)
    logForDebugging(
      `[ScheduledTasks] acquired scheduler lock (PID ${process.pid})`,
    )
    return true
  }

  const existing = await readLock(dir)

  // Already ours (idempotent). After --resume the session ID is restored
  // but the process has a new PID — update the lock file so other sessions
  // see a live PID and don't steal it.
  if (existing?.sessionId === sessionId) {
    if (existing.pid !== process.pid) {
      await writeFile(getLockPath(dir), jsonStringify(lock))
      registerLockCleanup(opts)
    }
    return true
  }

  // Corrupt or unparseable — treat as stale.
  // Another live session — blocked.
  if (existing && isProcessRunning(existing.pid)) {
    if (lastBlockedBy !== existing.sessionId) {
      lastBlockedBy = existing.sessionId
      logForDebugging(
        `[ScheduledTasks] scheduler lock held by session ${existing.sessionId} (PID ${existing.pid})`,
      )
    }
    return false
  }

  // Stale — unlink and retry the exclusive create once.
  if (existing) {
    logForDebugging(
      `[ScheduledTasks] recovering stale scheduler lock from PID ${existing.pid}`,
    )
  }
  await unlink(getLockPath(dir)).catch(() => {})
  if (await tryCreateExclusive(lock, dir)) {
    lastBlockedBy = undefined
    registerLockCleanup(opts)
    return true
  }
  // Another session won the recovery race.
  return false
}
// tryAcquireSchedulerLock 收尾：覆盖三条分支——已是我们自己（幂等重取）、另一存活会话（返回 false）、陈旧锁（删后重试一次，竞争失败者返回 false）。

/**
 * Release the scheduler lock if the current session owns it.
 */
export async function releaseSchedulerLock(
// releaseSchedulerLock 入口：若当前会话持有锁则释放。
  opts?: SchedulerLockOptions,
): Promise<void> {
  unregisterCleanup?.()
  unregisterCleanup = undefined
  lastBlockedBy = undefined

  const dir = opts?.dir
  const sessionId = opts?.lockIdentity ?? getSessionId()
  const existing = await readLock(dir)
  if (!existing || existing.sessionId !== sessionId) return
  try {
    await unlink(getLockPath(dir))
    logForDebugging('[ScheduledTasks] released scheduler lock')
  } catch {
    // Already gone.
  }
}
// releaseSchedulerLock 收尾：注销清理钩子并删除锁文件，文件已不存在则忽略。
