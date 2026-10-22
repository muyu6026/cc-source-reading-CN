// Lock file whose mtime IS lastConsolidatedAt. Body is the holder's PID.
//
// Lives inside the memory dir (getAutoMemPath) so it keys on git-root
// like memory does, and so it's writable even when the memory path comes
// from an env/settings override whose parent may not be.
// 这份文件的设计一句话概括：**锁文件的 mtime 就是「上次整理时间」**。一个文件同时承担两个角色——存在性与时间戳当日志（时间门读它），内容（PID）当锁。好处是不用额外维护一份「上次整理」状态文件，坏处是**回滚必须精确改回 mtime**（见 `rollbackConsolidationLock`）。它被放在记忆目录里而不是临时目录，是为了跟着 git-root 走（同一个仓库共享一把锁），同时保证「记忆路径被 env / settings 改到别处」时仍然可写——那个路径的父目录可能不可写，但它自己得能写。

import { mkdir, readFile, stat, unlink, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import { logForDebugging } from '../../utils/debug.js'
import { isProcessRunning } from '../../utils/genericProcessUtils.js'
import { listCandidates } from '../../utils/listSessionsImpl.js'
import { getProjectDir } from '../../utils/sessionStorage.js'

const LOCK_FILE = '.consolidate-lock'

// Stale past this even if the PID is live (PID reuse guard).
const HOLDER_STALE_MS = 60 * 60 * 1000
// 硬超时：哪怕 PID 还活着，锁超过 1 小时也算陈腐。这是 **PID 复用**的兜底——进程崩溃后 PID 被系统分给别的进程，`isProcessRunning` 会误判成「持有者还活着」，没有这个上限的话锁就永远解不开了。

function lockPath(): string {
  return join(getAutoMemPath(), LOCK_FILE)
}

/**
 * mtime of the lock file = lastConsolidatedAt. 0 if absent.
 * Per-turn cost: one stat.
 */
export async function readLastConsolidatedAt(): Promise<number> {
  try {
    const s = await stat(lockPath())
    return s.mtimeMs
  } catch {
    return 0
  }
}
// 每轮对话都会调它，所以只做一次 `stat`、不做任何解析。文件不存在返回 `0`——这个 `0` 在回滚里有特殊含义（见下）：代表「本来就没有锁文件」，而不是「1970 年整理过」。

/**
 * Acquire: write PID → mtime = now. Returns the pre-acquire mtime
 * (for rollback), or null if blocked / lost a race.
 *
 *   Success → do nothing. mtime stays at now.
 *   Failure → rollbackConsolidationLock(priorMtime) rewinds mtime.
 *   Crash   → mtime stuck, dead PID → next process reclaims.
 */
export async function tryAcquireConsolidationLock(): Promise<number | null> {
  const path = lockPath()

  let mtimeMs: number | undefined
  let holderPid: number | undefined
  try {
    const [s, raw] = await Promise.all([stat(path), readFile(path, 'utf8')])
    mtimeMs = s.mtimeMs
    const parsed = parseInt(raw.trim(), 10)
    holderPid = Number.isFinite(parsed) ? parsed : undefined
  } catch {
    // ENOENT — no prior lock.
  }

  if (mtimeMs !== undefined && Date.now() - mtimeMs < HOLDER_STALE_MS) {
    if (holderPid !== undefined && isProcessRunning(holderPid)) {
      logForDebugging(
        `[autoDream] lock held by live PID ${holderPid} (mtime ${Math.round((Date.now() - mtimeMs) / 1000)}s ago)`,
      )
      return null
    }
    // Dead PID or unparseable body — reclaim.
  }
// 接管判定只有一条：**mtime 够新 + PID 活着 → 让出**。其余情况（文件不存在 / mtime 陈腐 / PID 读不出 / PID 已死）一律往下走去抢。注意注释里那句「Dead PID or unparseable body — reclaim」——**内容坏了不影响接管**，宁可偶尔误抢，也不让一把坏锁永久堵住整理。

  // Memory dir may not exist yet.
  await mkdir(getAutoMemPath(), { recursive: true })
  await writeFile(path, String(process.pid))

  // Two reclaimers both write → last wins the PID. Loser bails on re-read.
  let verify: string
  try {
    verify = await readFile(path, 'utf8')
  } catch {
    return null
  }
  if (parseInt(verify.trim(), 10) !== process.pid) return null

  return mtimeMs ?? 0
// 回读验证与返回值的语义都在这一小段。**为什么必须回读**：这里没有 OS 级互斥（`writeFile` 不是「不存在才创建」），两个进程同时接管时是后写的赢，先写的那个回读会发现自己 PID 被覆盖，于是安静退出——这把锁是**咨询式**的，正确性靠回读而不是靠文件系统。**返回什么**：抢锁**之前**的 mtime（供回滚用），`?? 0` 是哨兵值，代表「原来根本没有锁文件」。
}

/**
 * Rewind mtime to pre-acquire after a failed fork. Clears the PID body —
 * otherwise our still-running process would look like it's holding.
 * priorMtime 0 → unlink (restore no-file).
 */
export async function rollbackConsolidationLock(
  priorMtime: number,
): Promise<void> {
  const path = lockPath()
  try {
    if (priorMtime === 0) {
      await unlink(path)
      return
    }
    await writeFile(path, '')
    const t = priorMtime / 1000 // utimes wants seconds
    await utimes(path, t, t)
  } catch (e: unknown) {
    logForDebugging(
      `[autoDream] rollback failed: ${(e as Error).message} — next trigger delayed to minHours`,
    )
  }
}
// 回滚有三个细节：① `priorMtime === 0` → **删文件**，而不是写一个 1970 的 mtime，恢复「从没有过锁」的原始状态；② 写时间戳前**先把内容清空**——否则本进程还活着、PID 还留在文件里，别的进程会以为锁仍被持有；③ `utimes` 收的单位是**秒**，所以要 `÷ 1000`。失败只记日志不抛：回滚是尽力而为，最坏情况是下次整理推迟一个 `minHours`。

/**
 * Session IDs with mtime after sinceMs. listCandidates handles UUID
 * validation (excludes agent-*.jsonl) and parallel stat.
 *
 * Uses mtime (sessions TOUCHED since), not birthtime (0 on ext4).
 * Caller excludes the current session. Scans per-cwd transcripts — it's
 * a skip-gate, so undercounting worktree sessions is safe.
 */
export async function listSessionsTouchedSince(
  sinceMs: number,
): Promise<string[]> {
  const dir = getProjectDir(getOriginalCwd())
  const candidates = await listCandidates(dir, true)
  return candidates.filter(c => c.mtime > sinceMs).map(c => c.sessionId)
}
// 两处刻意的取舍：**用 mtime 不用 birthtime**——`ext4` 上 birthtime 恒为 0，拿它判断「新建于何时」在 Linux 上直接失效；**只扫当前 cwd 的 transcript 目录**、不追 worktree——因为本函数服务于「跳过闸」，少算几个会话的代价只是晚点整理，多算才会白烧 token。

/**
 * Stamp from manual /dream. Optimistic — fires at prompt-build time,
 * no post-skill completion hook. Best-effort.
 */
export async function recordConsolidation(): Promise<void> {
  try {
    // Memory dir may not exist yet (manual /dream before any auto-trigger).
    await mkdir(getAutoMemPath(), { recursive: true })
    await writeFile(lockPath(), String(process.pid))
  } catch (e: unknown) {
    logForDebugging(
      `[autoDream] recordConsolidation write failed: ${(e as Error).message}`,
    )
  }
}
// 手动 `/dream` 的印章。为什么单独一个函数、且只写文件不抢锁：手动跑是在主循环里同步执行的，**fire 在 prompt 构建时刻**，之后没有「完成钩子」可挂，所以只能乐观打卡——哪怕用户中途 Ctrl-C，也当作整理过了（注释自己写了 `Optimistic` / `Best-effort`）。这里也补了一次 `mkdir`，因为可能是全新用户、记忆目录还不存在时就手动 `/dream`。
