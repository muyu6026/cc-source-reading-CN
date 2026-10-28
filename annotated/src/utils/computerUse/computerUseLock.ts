import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { getSessionId } from '../../bootstrap/state.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import { getErrnoCode } from '../errors.js'

const LOCK_FILENAME = 'computer-use.lock'
// 锁文件名固定为 computer-use.lock，放在 Claude 配置主目录下。

// Holds the unregister function for the shutdown cleanup handler.
// Set when the lock is acquired, cleared when released.
let unregisterCleanup: (() => void) | undefined
// 持有解锁函数的引用：加锁时登记、释放时清掉，用于关机清理。

type ComputerUseLock = {
  readonly sessionId: string
  readonly pid: number
  readonly acquiredAt: number
}

export type AcquireResult =
  | { readonly kind: 'acquired'; readonly fresh: boolean }
  | { readonly kind: 'blocked'; readonly by: string }
// AcquireResult：加锁结果——acquired（分 fresh 与 reentrant 两种）或 blocked（by 谁持有）。

export type CheckResult =
  | { readonly kind: 'free' }
  | { readonly kind: 'held_by_self' }
  | { readonly kind: 'blocked'; readonly by: string }

const FRESH: AcquireResult = { kind: 'acquired', fresh: true }
const REENTRANT: AcquireResult = { kind: 'acquired', fresh: false }

function isComputerUseLock(value: unknown): value is ComputerUseLock {
// isComputerUseLock：运行时类型守卫，校验锁文件 JSON 的形态（sessionId 为字符串、pid 为数字）。
  if (typeof value !== 'object' || value === null) return false
  return (
    'sessionId' in value &&
    typeof value.sessionId === 'string' &&
    'pid' in value &&
    typeof value.pid === 'number'
  )
}

function getLockPath(): string {
// getLockPath：锁文件完整路径 = 配置主目录 + 文件名。
  return join(getClaudeConfigHomeDir(), LOCK_FILENAME)
}

async function readLock(): Promise<ComputerUseLock | undefined> {
// readLock：读锁文件并 JSON 解析，形态不符或读取失败都视为无锁。
  try {
    const raw = await readFile(getLockPath(), 'utf8')
    const parsed: unknown = jsonParse(raw)
    return isComputerUseLock(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Check whether a process is still running (signal 0 probe).
 *
 * Note: there is a small window for PID reuse — if the owning process
 * exits and an unrelated process is assigned the same PID, the check
 * will return true. This is extremely unlikely in practice.
 */
function isProcessRunning(pid: number): boolean {
// isProcessRunning：用 signal 0 探测进程是否还活着（存在 PID 复用的极小窗口，实践中极罕见）。
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Attempt to create the lock file atomically with O_EXCL.
 * Returns true on success, false if the file already exists.
 * Throws for other errors.
 */
async function tryCreateExclusive(lock: ComputerUseLock): Promise<boolean> {
// tryCreateExclusive：用 O_EXCL（wx 标志）原子创建锁文件，已存在则返回 false，其余错误上抛。
  try {
    await writeFile(getLockPath(), jsonStringify(lock), { flag: 'wx' })
    return true
  } catch (e: unknown) {
    if (getErrnoCode(e) === 'EEXIST') return false
    throw e
  }
}

/**
 * Register a shutdown cleanup handler so the lock is released even if
 * turn-end cleanup is never reached (e.g. the user runs /exit while
 * a tool call is in progress).
 */
function registerLockCleanup(): void {
// registerLockCleanup：登记关机清理，保证即便没走到回合末清理（如 /exit 中途）也会释放锁。
  unregisterCleanup?.()
  unregisterCleanup = registerCleanup(async () => {
    await releaseComputerUseLock()
  })
}

/**
 * Check lock state without acquiring. Used for `request_access` /
 * `list_granted_applications` — the package's `defersLockAcquire` contract:
 * these tools check but don't take the lock, so the enter-notification and
 * overlay don't fire while the model is only asking for permission.
 *
 * Does stale-PID recovery (unlinks) so a dead session's lock doesn't block
 * `request_access`. Does NOT create — that's `tryAcquireComputerUseLock`'s job.
 */
export async function checkComputerUseLock(): Promise<CheckResult> {
// checkComputerUseLock：只查不抢（defersLockAcquire 契约）——request_access 等工具用它判断是否阻塞，不触发进入通知。
  const existing = await readLock()
  if (!existing) return { kind: 'free' }
  if (existing.sessionId === getSessionId()) return { kind: 'held_by_self' }
  if (isProcessRunning(existing.pid)) {
    return { kind: 'blocked', by: existing.sessionId }
  }
  logForDebugging(
    `Recovering stale computer-use lock from session ${existing.sessionId} (PID ${existing.pid})`,
  )
  await unlink(getLockPath()).catch(() => {})
  return { kind: 'free' }
}

/**
 * Zero-syscall check: does THIS process believe it holds the lock?
 * True iff `tryAcquireComputerUseLock` succeeded and `releaseComputerUseLock`
 * hasn't run yet. Used to gate the per-turn release in `cleanup.ts` so
 * non-CU turns don't touch disk.
 */
export function isLockHeldLocally(): boolean {
// isLockHeldLocally：零系统调用判断本进程是否认为自己持有锁，用于门控 cleanup.ts 的每回合释放（非 CU 回合不碰磁盘）。
  return unregisterCleanup !== undefined
}

/**
 * Try to acquire the computer-use lock for the current session.
 *
 * `{kind: 'acquired', fresh: true}` — first tool call of a CU turn. Callers fire
 * enter notifications on this. `{kind: 'acquired', fresh: false}` — re-entrant,
 * same session already holds it. `{kind: 'blocked', by}` — another live session
 * holds it.
 *
 * Uses O_EXCL (open 'wx') for atomic test-and-set — the OS guarantees at
 * most one process sees the create succeed. If the file already exists,
 * we check ownership and PID liveness; for a stale lock we unlink and
 * retry the exclusive create once. If two sessions race to recover the
 * same stale lock, only one create succeeds (the other reads the winner).
 */
export async function tryAcquireComputerUseLock(): Promise<AcquireResult> {
// tryAcquireComputerUseLock：用 O_EXCL 做原子 test-and-set，至多一个进程创建成功；陈旧锁则 unlink 后重试一次。
  const sessionId = getSessionId()
  const lock: ComputerUseLock = {
    sessionId,
    pid: process.pid,
    acquiredAt: Date.now(),
  }

  await mkdir(getClaudeConfigHomeDir(), { recursive: true })

  // Fresh acquisition.
  if (await tryCreateExclusive(lock)) {
    registerLockCleanup()
    return FRESH
  }

  const existing = await readLock()

  // Corrupt/unparseable — treat as stale (can't extract a blocking ID).
  if (!existing) {
    await unlink(getLockPath()).catch(() => {})
    if (await tryCreateExclusive(lock)) {
      registerLockCleanup()
      return FRESH
    }
    return { kind: 'blocked', by: (await readLock())?.sessionId ?? 'unknown' }
  }

  // Already held by this session.
  if (existing.sessionId === sessionId) return REENTRANT

  // Another live session holds it — blocked.
  if (isProcessRunning(existing.pid)) {
    return { kind: 'blocked', by: existing.sessionId }
  }

  // Stale lock — recover. Unlink then retry the exclusive create.
  // If another session is also recovering, one EEXISTs and reads the winner.
  logForDebugging(
    `Recovering stale computer-use lock from session ${existing.sessionId} (PID ${existing.pid})`,
  )
  await unlink(getLockPath()).catch(() => {})
  if (await tryCreateExclusive(lock)) {
    registerLockCleanup()
    return FRESH
  }
  return { kind: 'blocked', by: (await readLock())?.sessionId ?? 'unknown' }
}

/**
 * Release the computer-use lock if the current session owns it. Returns
 * `true` if we actually unlinked the file (i.e., we held it) — callers fire
 * exit notifications on this. Idempotent: subsequent calls return `false`.
 */
export async function releaseComputerUseLock(): Promise<boolean> {
// releaseComputerUseLock：仅当本会话拥有锁才 unlink 并返回 true（调用方据此发退出通知）；幂等，重复调用返回 false。
  unregisterCleanup?.()
  unregisterCleanup = undefined

  const existing = await readLock()
  if (!existing || existing.sessionId !== getSessionId()) return false
  try {
    await unlink(getLockPath())
    logForDebugging('Released computer-use lock')
    return true
  } catch {
    return false
  }
}
