import { type FSWatcher, watch } from 'fs'
import { useEffect, useSyncExternalStore } from 'react'
import { useAppState, useSetAppState } from '../state/AppState.js'
import { createSignal } from '../utils/signal.js'
import type { Task } from '../utils/tasks.js'
import {
  getTaskListId,
  getTasksDir,
  isTodoV2Enabled,
  listTasks,
  onTasksUpdated,
  resetTaskList,
} from '../utils/tasks.js'
import { isTeamLead } from '../utils/teammate.js'

const HIDE_DELAY_MS = 5000
const DEBOUNCE_MS = 50
const FALLBACK_POLL_MS = 5000 // Fallback in case fs.watch misses events
// 三个时间常数一次定齐：5s 隐藏延迟、50ms 去抖、5s 兜底轮询
// （fs.watch 在某些平台会丢事件，轮询是安全网）。

/**
 * Singleton store for the TodoV2 task list. Owns the file watcher, timers,
 * and cached task list. Multiple hook instances (REPL, Spinner,
 * PromptInputFooterLeftSide) subscribe to one shared store instead of each
 * setting up their own fs.watch on the same directory. The Spinner mounts/
 * unmounts every turn — per-hook watchers caused constant watch/unwatch churn.
 *
 * Implements the useSyncExternalStore contract: subscribe/getSnapshot.
 */
// 为什么是单例 store：REPL、Spinner、PromptInputFooterLeftSide
// 多处消费同一份任务列表。若每个 hook 实例各自 fs.watch 同一目录，
// Spinner 每轮挂载/卸载都会造成 watch/unwatch 抖动。
// store 实现 useSyncExternalStore 契约（subscribe/getSnapshot）。
class TasksV2Store {
  /** Stable array reference; replaced only on fetch. undefined until started. */
  #tasks: Task[] | undefined = undefined
// 稳定引用：只有 fetch 到新数组才替换，
// Object.is 比较才能命中缓存。
  /**
   * Set when the hide timer has elapsed (all tasks completed for >5s), or
   * when the task list is empty. Starts false so the first fetch runs the
   * "all completed → schedule 5s hide" path (matches original behavior:
   * resuming a session with completed tasks shows them briefly).
   */
  #hidden = false
// 隐藏标志初值 false 是有意的——首帧也会走「全完成 → 排 5s 隐藏」
// 路径，恢复会话时已完成的任务能短暂显示一下，与原行为一致。
  #watcher: FSWatcher | null = null
  #watchedDir: string | null = null
  #hideTimer: ReturnType<typeof setTimeout> | null = null
  #debounceTimer: ReturnType<typeof setTimeout> | null = null
  #pollTimer: ReturnType<typeof setTimeout> | null = null
  #unsubscribeTasksUpdated: (() => void) | null = null
  #changed = createSignal()
  #subscriberCount = 0
  #started = false
// #started 防重入：只有第一个订阅者触发启动，
// 最后一个退出才真正停止。

  /**
   * useSyncExternalStore snapshot. Returns the same Task[] reference between
   * updates (required for Object.is stability). Returns undefined when hidden.
   */
  getSnapshot = (): Task[] | undefined => {
    return this.#hidden ? undefined : this.#tasks
  }
// hidden 时快照返回 undefined：React 侧拿到 undefined 即
// 「不渲染列表」，比返回空数组少一次 diff。

  subscribe = (fn: () => void): (() => void) => {
    // Lazy init on first subscriber. useSyncExternalStore calls this
    // post-commit, so I/O here is safe (no render-phase side effects).
    // REPL.tsx keeps a subscription alive for the whole session, so
    // Spinner mount/unmount churn never drives the count to zero.
    const unsubscribe = this.#changed.subscribe(fn)
    this.#subscriberCount++
    if (!this.#started) {
      this.#started = true
      this.#unsubscribeTasksUpdated = onTasksUpdated(this.#debouncedFetch)
// 进程内更新（TaskCreateTool 等写者）不走 fs.watch，
// 直接订阅事件总线。
      // Fire-and-forget: subscribe is called post-commit (not in render),
      // and the store notifies subscribers when the fetch resolves.
      void this.#fetch()
// 首拉 fire-and-forget：subscribe 在 commit 后调用，不是渲染期，
// 这里发起 I/O 安全；结果由 store 自己 notify。
    }
    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      unsubscribe()
      this.#subscriberCount--
      if (this.#subscriberCount === 0) this.#stop()
    }
  }
// 退订幂等：重复调用同一个 unsubscribe 只减一次计数；
// 计数归零才 #stop()——REPL 整个会话持有订阅，
// Spinner 的来回挂载不会把计数打到 0。

  #notify(): void {
    this.#changed.emit()
  }

  /**
   * Point the file watcher at the current tasks directory. Called on start
   * and whenever #fetch detects the task list ID has changed (e.g. when
   * TeamCreateTool sets leaderTeamName mid-session).
   */
// 重盯目录的两个时机：启动时；fetch 发现 taskListId 变了
// （TeamCreateTool 会在会话中途设置 leaderTeamName）。
  #rewatch(dir: string): void {
    // Retry even on same dir if the previous watch attempt failed (dir
    // didn't exist yet). Once the watcher is established, same-dir is a no-op.
    if (dir === this.#watchedDir && this.#watcher !== null) return
    this.#watcher?.close()
    this.#watcher = null
    this.#watchedDir = dir
    try {
      this.#watcher = watch(dir, this.#debouncedFetch)
// watch 直接绑 #debouncedFetch：文件事件不需要额外加工，
// 去抖逻辑复用在事件回调上。unref() 让 watcher 不拖住事件循环退出。
      this.#watcher.unref()
    } catch {
      // Directory may not exist yet (ensureTasksDir is called by writers).
      // Not critical — onTasksUpdated covers in-process updates and the
      // poll timer covers cross-process updates.
    }
// 目录可能还没被写者创建（ensureTasksDir 由写入方负责）——
// watch 抛 ENOENT 时静默：进程内事件 + 轮询双保险已经覆盖。
  }
// 同一目录不重盯，除非上一次 watch 失败（#watcher 仍是 null）——
// 给「目录晚点出现」留一次重试机会。

  #debouncedFetch = (): void => {
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer)
    this.#debounceTimer = setTimeout(() => void this.#fetch(), DEBOUNCE_MS)
    this.#debounceTimer.unref()
  }
// 50ms 去抖：一次批量写会产生多个 fs 事件，合并成一次 fetch。

  #fetch = async (): Promise<void> => {
    const taskListId = getTaskListId()
    // Task list ID can change mid-session (TeamCreateTool sets
    // leaderTeamName) — point the watcher at the current dir.
    this.#rewatch(getTasksDir(taskListId))
    const current = (await listTasks(taskListId)).filter(
      t => !t.metadata?._internal,
    )
    this.#tasks = current
// 过滤 _internal：合成/内部任务不进 UI 列表，
// 与 TaskList 的过滤规则保持一处实现。

    const hasIncomplete = current.some(t => t.status !== 'completed')

    if (hasIncomplete || current.length === 0) {
// 有未完成任务（或列表空）→ 重置隐藏态并清掉隐藏定时器；
// 列表为空时直接 hidden = true，省一个定时器。
      // Has unresolved tasks (open/in_progress) or empty — reset hide state
      this.#hidden = current.length === 0
      this.#clearHideTimer()
    } else if (this.#hideTimer === null && !this.#hidden) {
// 全部刚变成 completed → 排 5s 隐藏；已排过（或已隐藏）不重排。
      // All tasks just became completed — schedule clear
      this.#hideTimer = setTimeout(
        this.#onHideTimerFired.bind(this, taskListId),
        HIDE_DELAY_MS,
      )
      this.#hideTimer.unref()
    }

    this.#notify()
// 每次 fetch 完都 notify：订阅者按快照引用变化
// 自行决定是否重渲染。

    // Schedule fallback poll only when there are incomplete tasks that
    // need monitoring. When all tasks are completed (or there are none),
    // the fs.watch watcher and onTasksUpdated callback are sufficient to
    // detect new activity — no need to keep polling and re-rendering.
    if (this.#pollTimer) {
      clearTimeout(this.#pollTimer)
      this.#pollTimer = null
    }
    if (hasIncomplete) {
      this.#pollTimer = setTimeout(this.#debouncedFetch, FALLBACK_POLL_MS)
      this.#pollTimer.unref()
    }
// 轮询只在有未完成任务时才排：全完成/无任务时 fs.watch 加事件总线
// 足够感知新活动，持续空转轮询只会白烧 CPU 和重渲染。
  }

  #onHideTimerFired(scheduledForTaskListId: string): void {
    this.#hideTimer = null
    // Bail if the task list ID changed since scheduling (team created/deleted
    // during the 5s window) — don't reset the wrong list.
    const currentId = getTaskListId()
    if (currentId !== scheduledForTaskListId) return
// 隐藏定时器触发时先核对 taskListId：5 秒窗口内队伍可能已建/已散，
// 不能拿旧的 id 去 reset 错误的列表。
    // Verify all tasks are still completed before clearing
    void listTasks(currentId).then(async tasksToCheck => {
// 二次确认：定时器到点后重新拉一次列表，确认「仍然全部 completed」
// 且非空，才真正 resetTaskList——防止定时器排下后又来了新任务。
      const allStillCompleted =
        tasksToCheck.length > 0 &&
        tasksToCheck.every(t => t.status === 'completed')
      if (allStillCompleted) {
        await resetTaskList(currentId)
        this.#tasks = []
        this.#hidden = true
      }
      this.#notify()
    })
  }
// reset 成功后本地缓存也清空并置 hidden：
// UI 侧随即收到 undefined 快照。

  #clearHideTimer(): void {
    if (this.#hideTimer) {
      clearTimeout(this.#hideTimer)
      this.#hideTimer = null
    }
  }

  /**
   * Tear down the watcher, timers, and in-process subscription. Called when
   * the last subscriber unsubscribes. Preserves #tasks/#hidden cache so a
   * subsequent re-subscribe renders the last known state immediately.
   */
// #stop 只停 watcher/定时器/订阅，保留 #tasks/#hidden 缓存：
// 重新订阅时第一帧就能渲染上次已知状态，不闪空。
  #stop(): void {
    this.#watcher?.close()
    this.#watcher = null
    this.#watchedDir = null
    this.#unsubscribeTasksUpdated?.()
    this.#unsubscribeTasksUpdated = null
    this.#clearHideTimer()
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer)
    if (this.#pollTimer) clearTimeout(this.#pollTimer)
    this.#debounceTimer = null
    this.#pollTimer = null
    this.#started = false
  }
// #started 复位让下一次订阅重新走懒启动；缓存不清（见上方注释）。
}

let _store: TasksV2Store | null = null
function getStore(): TasksV2Store {
  return (_store ??= new TasksV2Store())
}
// 模块级单例，进程内唯一；不导出 store 本身，只通过 hook 暴露。

// Stable no-ops for the disabled path so useSyncExternalStore doesn't
// churn its subscription on every render.
const NOOP = (): void => {}
const NOOP_SUBSCRIBE = (): (() => void) => NOOP
const NOOP_SNAPSHOT = (): undefined => undefined
// 禁用路径（TodoV2 关或非 leader）用三个稳定 no-op 占位：
// useSyncExternalStore 的 subscribe/getSnapshot 引用不变，
// 不会每渲染重新订阅。

/**
 * Hook to get the current task list for the persistent UI display.
 * Returns tasks when TodoV2 is enabled, otherwise returns undefined.
 * All hook instances share a single file watcher via TasksV2Store.
 * Hides the list after 5 seconds if there are no open tasks.
 */
// useTasksV2：TodoV2 开启且（无队伍上下文或是 leader）才返回列表，
// 其余返回 undefined。所有实例共享同一个 store 的 fs.watch。
export function useTasksV2(): Task[] | undefined {
  const teamContext = useAppState(s => s.teamContext)

  const enabled = isTodoV2Enabled() && (!teamContext || isTeamLead(teamContext))
// 双闸门：功能开关 + 队伍身份。队友（非 leader）不显示任务列表——
// 那是 leader 的 UI。

  const store = enabled ? getStore() : null

  return useSyncExternalStore(
    store ? store.subscribe : NOOP_SUBSCRIBE,
    store ? store.getSnapshot : NOOP_SNAPSHOT,
  )
// useSyncExternalStore 的两个参数按启用与否整体切换，
// 保证禁用时引用恒定（见 NOOP 三件套）。
}

/**
 * Same as useTasksV2, plus collapses the expanded task view when the list
 * becomes hidden. Call this from exactly one always-mounted component (REPL)
 * so the collapse effect runs once instead of N× per consumer.
 */
// useTasksV2WithCollapseEffect 只给一个常驻组件（REPL）用：
// 列表隐藏时自动收起展开态，效果只跑一次，
// 不会 N 个消费者各跑一遍。
export function useTasksV2WithCollapseEffect(): Task[] | undefined {
  const tasks = useTasksV2()
  const setAppState = useSetAppState()

  const hidden = tasks === undefined
  useEffect(() => {
    if (!hidden) return
    setAppState(prev => {
      if (prev.expandedView !== 'tasks') return prev
      return { ...prev, expandedView: 'none' as const }
    })
  }, [hidden, setAppState])
// 依赖 [hidden, setAppState]：hidden 由 undefined 与 数组 驱动，
// 只在「有→无」那一刻触发收起。

  return tasks
}
