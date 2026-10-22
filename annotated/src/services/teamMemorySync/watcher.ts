// 【模块总览】`watcher.ts` 是团队记忆同步的**后台守护进程**部分：监听本地团队记忆目录的改动，
// 在安静 2 秒后触发一次「推」到服务器（防抖），并在启动时先做一次「拉」。
// 它和 `index.ts` 是配套的两个文件——`index.ts` 是无状态同步纯函数，本文件是**有状态的单例 watcher**。
// 注意第 10 行 `import { feature } from 'bun:bundle'`：`TEAMMEM` 是构建期开关，关掉时整个同步系统不启用。
/**
 * Team Memory File Watcher
 *
 * Watches the team memory directory for changes and triggers
 * a debounced push to the server when files are modified.
 * Performs an initial pull on startup, then starts a directory-level
 * fs.watch so first-time writes to a fresh repo get picked up.
 */

import { feature } from 'bun:bundle'
import { type FSWatcher, watch } from 'fs'
import { mkdir, stat } from 'fs/promises'
import { join } from 'path'
import {
  getTeamMemPath,
  isTeamMemoryEnabled,
} from '../../memdir/teamMemPaths.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { getGithubRepo } from '../../utils/git.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  createSyncState,
  isTeamMemorySyncAvailable,
  pullTeamMemory,
  pushTeamMemory,
  type SyncState,
} from './index.js'
import type { TeamMemorySyncPushResult } from './types.js'

const DEBOUNCE_MS = 2000 // Wait 2s after last change before pushing
// 【第 35 行】`DEBOUNCE_MS = 2000`：最后一次改动后等 2 秒再推送。
// 为什么需要防抖？编辑器/工具连续写文件会瞬间触发一大波事件，每次都立刻推送会打爆服务器；
// 等 2 秒让写入「落定」后只推一次，既省流量又避免半截内容被同步上去。

// ─── Watcher state ──────────────────────────────────────────
// 【第 38-51 行】本文件刻意用**模块级可变状态**（`watcher` / `debounceTimer` / `pushInProgress` /
// `hasPendingChanges` / `currentPushPromise` / `watcherStarted`）—— 这和 `index.ts`「零模块状态」是
// 两种不同取舍：`index.ts` 是纯函数库、状态由调用方持有以保证测试隔离；而 watcher 本身就是个全局唯一
// 的监听器，天然需要这些状态。
// 最值得讲的是 `pushSuppressedReason`（第 45-51 行）：它是「不可自愈的失败」护栏。BQ 上曾有一个
// `no_oauth` 设备 2.5 天吐了 16.7 万次 push 事件、形成无限重试循环——所以一旦遇到永久失败
// （无 OAuth / 无 repo / 4xx 非 409/429），就记下原因并**停止自动重试**，直到用户删文件（unlink，
// 是 too-many-entries 的恢复动作）或进程重启才解除。
let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pushInProgress = false
let hasPendingChanges = false
let currentPushPromise: Promise<void> | null = null
let watcherStarted = false

// Set after a push fails for a reason that can't self-heal on retry.
// Prevents watch events from other sessions' writes to the shared team
// dir driving an infinite retry loop (BQ Mar 14-16: one no_oauth device
// emitted 167K push events over 2.5 days). Cleared on unlink — file deletion
// is a recovery action for the too-many-entries case, and for no_oauth the
// suppression persisting until session restart is correct.
let pushSuppressedReason: string | null = null

/**
 * Permanent = retry without user action will fail the same way.
 * - no_oauth / no_repo: pre-request client checks, no status code
 * - 4xx except 409/429: client error (404 missing repo, 413 too many
 *   entries, 403 permission). 409 is a transient conflict — server state
 *   changed under us, a fresh push after next pull can succeed. 429 is a
 *   rate limit — watcher-driven backoff is fine.
 */
// 【第 53-73 行】`isPermanentFailure` 判定哪些失败「重试也没用」：
// · `no_oauth` / `no_repo`：请求前就能确定的客户端错误，没有状态码；
// · `4xx`（除 409/429）：客户端错误（404 找不到 repo、413 太多条目、403 没权限）。
//   409 是**瞬时冲突**（服务器状态在我们之下变了，下次 pull 后重推可能成功），429 是**限流**
//   （watcher 自己的退避就够）——这两种不算永久失败。
export function isPermanentFailure(r: TeamMemorySyncPushResult): boolean {
  if (r.errorType === 'no_oauth' || r.errorType === 'no_repo') return true
  if (
    r.httpStatus !== undefined &&
    r.httpStatus >= 400 &&
    r.httpStatus < 500 &&
    r.httpStatus !== 409 &&
    r.httpStatus !== 429
  ) {
    return true
  }
  return false
}

// Sync state owned by the watcher — shared across all sync operations.
let syncState: SyncState | null = null

/**
 * Execute the push and track its lifecycle.
 * Push is read-only on disk (delta+probe, no merge writes), so no event
 * suppression is needed — edits arriving mid-push hit schedulePush() and
 * the debounce re-arms after this push completes.
 */
// 【第 78-127 行】`executePush` 执行一次推送并管理生命周期。
// 关键点：推送对磁盘是**只读**的（只有 delta + 探针，没有合并写盘），所以不需要压制事件——
// 推送途中到达的编辑会进入 `schedulePush()`，在本次推送完成后防抖重新计时。
// 成功后清 `hasPendingChanges`；失败后若判为永久失败且还没压过，就设置 `pushSuppressedReason`
// 并上报 `tengu_team_mem_push_suppressed` 遥测（带原因，绝不带密钥值/路径）。
async function executePush(): Promise<void> {
  if (!syncState) {
    return
  }
  pushInProgress = true
  try {
    const result = await pushTeamMemory(syncState)
    if (result.success) {
      hasPendingChanges = false
    }
    if (result.success && result.filesUploaded > 0) {
      logForDebugging(
        `team-memory-watcher: pushed ${result.filesUploaded} files`,
        { level: 'info' },
      )
    } else if (!result.success) {
      logForDebugging(`team-memory-watcher: push failed: ${result.error}`, {
        level: 'warn',
      })
      if (isPermanentFailure(result) && pushSuppressedReason === null) {
        pushSuppressedReason =
          result.httpStatus !== undefined
            ? `http_${result.httpStatus}`
            : (result.errorType ?? 'unknown')
        logForDebugging(
          `team-memory-watcher: suppressing retry until next unlink or session restart (${pushSuppressedReason})`,
          { level: 'warn' },
        )
        logEvent('tengu_team_mem_push_suppressed', {
          reason:
            pushSuppressedReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...(result.httpStatus && { status: result.httpStatus }),
        })
      }
    }
  } catch (e) {
    logForDebugging(`team-memory-watcher: push error: ${errorMessage(e)}`, {
      level: 'warn',
    })
  } finally {
    pushInProgress = false
    currentPushPromise = null
  }
}

/**
 * Debounced push: waits for writes to settle, then pushes once.
 */
// 【第 129-145 行】`schedulePush` 是防抖调度：先标 `hasPendingChanges`，清掉旧定时器、
// 2 秒后触发 `executePush`。若触发时正好有推送在进行（`pushInProgress`），就**再 schedule 一次自己**
// （重新防抖），等当前推送结束后由它的收尾逻辑再排一次——这样就形成「推送期间来的编辑一定会再被排到」的闭环。
function schedulePush(): void {
  if (pushSuppressedReason !== null) return
  hasPendingChanges = true
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    if (pushInProgress) {
      schedulePush()
      return
    }
    currentPushPromise = executePush()
  }, DEBOUNCE_MS)
}

/**
 * Start watching the team memory directory for changes.
 *
 * Uses `fs.watch({recursive: true})` on the directory (not chokidar).
 * chokidar 4+ dropped fsevents, and Bun's `fs.watch` fallback uses kqueue,
 * which requires one open fd per watched file — with 500+ team memory files
 * that's 500+ permanently-held fds (confirmed via lsof + repro).
 *
 * `recursive: true` is required because team memory supports subdirs
 * (validateTeamMemKey, pushTeamMemory's walkDir). On macOS Bun uses
 * FSEvents for recursive — O(1) fds regardless of tree size (verified:
 * 2 fds for 60 files across 5 subdirs). On Linux inotify needs one watch
 * per directory — O(subdirs), still fine (team memory rarely nests).
 *
 * `fs.watch` on a directory doesn't distinguish add/change/unlink — all three
 * emit `rename`. To clear suppression on the too-many-entries recovery path
 * (user deletes files), we stat the filename on each event: ENOENT → treat as
 * unlink.  For `no_oauth` suppression this is correct: no_oauth users don't
 * delete team memory files to recover, they restart with auth.
 */
// 【第 147-229 行】`startFileWatcher` 用 `fs.watch({recursive: true})` 直接监听目录（**不用 chokidar**）。
// 为什么不用 chokidar？chokidar 4+ 丢弃了 fsevents，而 Bun 的 fallback 用 kqueue 会**每个被监听文件占一个 fd**——
// 500+ 个团队记忆文件就是 500+ 个常驻 fd（已用 lsof 复现确认）。用 FSEvents 递归监听是 O(1) 个 fd。
// 另一个坑：`fs.watch` 在目录上**不分 add/change/unlink**，三者都发 `rename` 事件。为了能在
// 「too-many-entries 恢复路径」（用户删文件）时解除压制，每个事件都 `stat` 一下文件名：
// `ENOENT` → 当成 unlink → 清 `pushSuppressedReason`。对于 `no_oauth` 压制这逻辑也正确
// （no_oauth 用户不会靠删文件恢复，他们改完权限重启就好）。
async function startFileWatcher(teamDir: string): Promise<void> {
  if (watcherStarted) {
    return
  }
  watcherStarted = true

  try {
    // pullTeamMemory returns early without creating the dir for fresh repos
    // with no server content (index.ts isEmpty path). mkdir with
    // recursive:true is idempotent — no existence check needed.
    await mkdir(teamDir, { recursive: true })

    watcher = watch(
      teamDir,
      { persistent: true, recursive: true },
      (_eventType, filename) => {
        if (filename === null) {
          schedulePush()
          return
        }
        if (pushSuppressedReason !== null) {
          // Suppression is only cleared by unlink (recovery action for
          // too-many-entries). fs.watch doesn't distinguish unlink from
          // add/write — stat to disambiguate. ENOENT → file gone → clear.
          void stat(join(teamDir, filename)).catch(
            (err: NodeJS.ErrnoException) => {
              if (err.code !== 'ENOENT') return
              if (pushSuppressedReason !== null) {
                logForDebugging(
                  `team-memory-watcher: unlink cleared suppression (was: ${pushSuppressedReason})`,
                  { level: 'info' },
                )
                pushSuppressedReason = null
              }
              schedulePush()
            },
          )
          return
        }
        schedulePush()
      },
    )
    watcher.on('error', err => {
      logForDebugging(
        `team-memory-watcher: fs.watch error: ${errorMessage(err)}`,
        { level: 'warn' },
      )
    })
    logForDebugging(`team-memory-watcher: watching ${teamDir}`, {
      level: 'debug',
    })
  } catch (err) {
    // fs.watch throws synchronously on ENOENT (race: dir deleted between
    // mkdir and watch) or EACCES. watcherStarted is already true above,
    // so notifyTeamMemoryWrite's explicit schedulePush path still works.
    logForDebugging(
      `team-memory-watcher: failed to watch ${teamDir}: ${errorMessage(err)}`,
      { level: 'warn' },
    )
  }

  registerCleanup(async () => stopTeamMemoryWatcher())
}

/**
 * Start the team memory sync system.
 *
 * Returns early (before creating any state) if:
 *   - TEAMMEM build flag is off
 *   - team memory is disabled (isTeamMemoryEnabled)
 *   - OAuth is not available (isTeamMemorySyncAvailable)
 *   - the current repo has no github.com remote
 *
 * The early github.com check prevents a noisy failure mode where the
 * watcher starts, it fires on local edits, and every push/pull
 * logs `errorType: no_repo` forever. Team memory is GitHub-scoped on
 * the server side, so non-github.com remotes can never sync anyway.
 *
 * Pulls from server, then starts the file watcher unconditionally.
 * The watcher must start even when the server has no content yet
 * (fresh EAP repo) — otherwise Claude's first team-memory write
 * depends entirely on PostToolUse hooks firing notifyTeamMemoryWrite,
 * which is a chicken-and-egg: Claude's write rate is low enough that
 * a fresh partner can sit in the bootstrap dead zone for days.
 */
// 【第 231-305 行】`startTeamMemoryWatcher` 是入口，在创建任何状态**之前**就尽早返回：
// `TEAMMEM` 关闭 / 功能禁用 / 没 OAuth / 当前 repo 没有 github.com remote 都直接 return。
// 那个 github.com 提前检查很关键：否则 watcher 启动后，本地每次编辑都会触发永远失败的
// `no_repo` 日志刷屏。团队记忆在服务端就是按 GitHub 隔离的，非 github.com 的 remote 根本同步不了。
// 接着做**初始拉取**（在 watcher 启动前，所以它的写盘不会触发 schedulePush），然后**无条件**启动 watcher——
// 即使服务端还没内容（全新仓库），也必须监听，否则 Claude 第一次写团队记忆会卡在「只能靠 PostToolUse
// 钩子触发」的鸡生蛋死区里（新伙伴可能好几天都进不了引导区）。
export async function startTeamMemoryWatcher(): Promise<void> {
  if (!feature('TEAMMEM')) {
    return
  }
  if (!isTeamMemoryEnabled() || !isTeamMemorySyncAvailable()) {
    return
  }
  const repoSlug = await getGithubRepo()
  if (!repoSlug) {
    logForDebugging(
      'team-memory-watcher: no github.com remote, skipping sync',
      { level: 'debug' },
    )
    return
  }

  syncState = createSyncState()

  // Initial pull from server (runs before the watcher starts, so its disk
  // writes won't trigger schedulePush)
  let initialPullSuccess = false
  let initialFilesPulled = 0
  let serverHasContent = false
  try {
    const pullResult = await pullTeamMemory(syncState)
    initialPullSuccess = pullResult.success
    serverHasContent = pullResult.entryCount > 0
    if (pullResult.success && pullResult.filesWritten > 0) {
      initialFilesPulled = pullResult.filesWritten
      logForDebugging(
        `team-memory-watcher: initial pull got ${pullResult.filesWritten} files`,
        { level: 'info' },
      )
    }
  } catch (e) {
    logForDebugging(
      `team-memory-watcher: initial pull failed: ${errorMessage(e)}`,
      { level: 'warn' },
    )
  }

  // Always start the watcher. Watching an empty dir is cheap,
  // and the alternative (lazy start on notifyTeamMemoryWrite) creates
  // a bootstrap dead zone for fresh repos.
  await startFileWatcher(getTeamMemPath())

  logEvent('tengu_team_mem_sync_started', {
    initial_pull_success: initialPullSuccess,
    initial_files_pulled: initialFilesPulled,
    // Kept for dashboard continuity; now always true when this event fires.
    watcher_started: true,
    server_has_content: serverHasContent,
  })
}

/**
 * Call this when a team memory file is written (e.g. from PostToolUse hooks).
 * Schedules a push explicitly in case fs.watch misses the write —
 * a file written in the same tick the watcher starts may not fire an
 * event, and some platforms coalesce rapid successive writes.
 * If the watcher does fire, the debounce timer just resets.
 */
// 【第 307-319 行】`notifyTeamMemoryWrite` 是钩子显式调用的「兜底排推」：万一 `fs.watch`
// 漏了某次写（watcher 启动那一 tick 内写的文件可能不触发事件；某些平台会合并连续快速写入），
// 这里手动排一次。如果 watcher 真的触发了，只不过让防抖定时器重置一下，无害。
export async function notifyTeamMemoryWrite(): Promise<void> {
  if (!syncState) {
    return
  }
  schedulePush()
}

/**
 * Stop the file watcher and flush pending changes.
 * Note: runs within the 2s graceful shutdown budget, so the flush
 * is best-effort — if the HTTP PUT doesn't complete in time,
 * process.exit() will kill it.
 */
// 【第 321-352 行】`stopTeamMemoryWatcher` 负责优雅关闭：清定时器、关 watcher、
// 等在途推送完成、最后**尽力 flush** 还没推的待改内容。注意整个流程在 2 秒关机预算内，
// HTTP PUT 不一定来得及完成——赶不上就被 `process.exit()` 杀掉，所以这是 best-effort。
export async function stopTeamMemoryWatcher(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    watcher.close()
    watcher = null
  }
  // Await any in-flight push
  if (currentPushPromise) {
    try {
      await currentPushPromise
    } catch {
      // Ignore errors during shutdown
    }
  }
  // Flush pending changes that were debounced but not yet pushed
  if (hasPendingChanges && syncState && pushSuppressedReason === null) {
    try {
      await pushTeamMemory(syncState)
    } catch {
      // Best-effort — shutdown may kill this
    }
  }
}

/**
 * Test-only: reset module state and optionally seed syncState.
 * The feature('TEAMMEM') gate at the top of startTeamMemoryWatcher() is
 * always false in bun test, so tests can't set syncState through the normal
 * path. This helper lets tests drive notifyTeamMemoryWrite() /
 * stopTeamMemoryWatcher() directly.
 *
 * `skipWatcher: true` marks the watcher as already-started without actually
 * starting it. Tests that only exercise the schedulePush/flush path don't
 * need a real watcher.
 */
// 【第 354-387 行】两个测试专用函数：
// `_resetWatcherStateForTesting` 重置模块状态并可选注入 `syncState`——因为 `startTeamMemoryWatcher`
// 顶部的 `feature('TEAMMEM')` 在 bun test 下永远是 false，测试走不了正常路径，只能靠它直接驱动
// `notifyTeamMemoryWrite` / `stopTeamMemoryWatcher`。`_startFileWatcherForTesting` 则真正启动
// `fs.watch`，供「fd 数量回归测试」使用（验证不会因递归监听泄漏 fd）。
export function _resetWatcherStateForTesting(opts?: {
  syncState?: SyncState
  skipWatcher?: boolean
  pushSuppressedReason?: string | null
}): void {
  watcher = null
  debounceTimer = null
  pushInProgress = false
  hasPendingChanges = false
  currentPushPromise = null
  watcherStarted = opts?.skipWatcher ?? false
  pushSuppressedReason = opts?.pushSuppressedReason ?? null
  syncState = opts?.syncState ?? null
}

/**
 * Test-only: start the real fs.watch on a specified directory.
 * Used by the fd-count regression test — startTeamMemoryWatcher() is gated
 * by feature('TEAMMEM') which is false under bun test.
 */
export function _startFileWatcherForTesting(dir: string): Promise<void> {
  return startFileWatcher(dir)
}
