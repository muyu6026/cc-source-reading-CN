import { type FSWatcher, watch } from 'fs'
import { useEffect, useRef } from 'react'
import { logForDebugging } from '../utils/debug.js'
import {
  claimTask,
  DEFAULT_TASKS_MODE_TASK_LIST_ID,
  ensureTasksDir,
  getTasksDir,
  listTasks,
  type Task,
  updateTask,
} from '../utils/tasks.js'

const DEBOUNCE_MS = 1000
// 1 秒去抖比 useTasksV2 的 50ms 粗得多：这里等的是「人来建任务」，
// 不是「自己刚写完文件」，没必要那么敏感。

type Props = {
  /** When undefined, the hook does nothing. The task list id is also used as the agent ID. */
  taskListId?: string
  isLoading: boolean
  /**
   * Called when a task is ready to be worked on.
   * Returns true if submission succeeded, false if rejected.
   */
  onSubmitTask: (prompt: string) => boolean
}
// onSubmitTask 返回 boolean：提交成功 true、被拒 false——
// watcher 据此决定继续占有还是释放 claim。

/**
 * Hook that watches a task list directory and automatically picks up
 * open, unowned tasks to work on.
 *
 * This enables "tasks mode" where Claude watches for externally-created
 * tasks and processes them one at a time.
 */
// 「任务模式」的发动机：盯住任务列表目录，自动捡无人认领的
// open 任务，一次一个提交给 Claude 干。taskListId 同时充当 agentId。
export function useTaskListWatcher({
  taskListId,
  isLoading,
  onSubmitTask,
}: Props): void {
// 两个 ref 是全部状态：当前任务 id、去抖定时器句柄。
// 不放进 state 是因为它们不驱动渲染。
  const currentTaskRef = useRef<string | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stabilize unstable props via refs so the watcher effect doesn't depend on
  // them. isLoading flips every turn, and onSubmitTask's identity changes
  // whenever onQuery's deps change. Without this, the watcher effect re-runs
  // on every turn, calling watcher.close() + watch() each time — which is a
  // trigger for Bun's PathWatcherManager deadlock (oven-sh/bun#27469).
// 为什么用 ref 中转 props：isLoading 每轮翻转、onSubmitTask 的
// 身份随 onQuery 依赖变。若 effect 直接依赖它们，每轮都会
// close()+watch() 一遍——这正是 Bun PathWatcherManager 死锁的
// 触发条件（oven-sh/bun#27469）。
  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading
  const onSubmitTaskRef = useRef(onSubmitTask)
  onSubmitTaskRef.current = onSubmitTask
// 渲染期直接写 ref（不在 effect 里）：保证 watcher 回调读到的
// 永远是最新值，且不引入新函数身份。

  const enabled = taskListId !== undefined
  const agentId = taskListId ?? DEFAULT_TASKS_MODE_TASK_LIST_ID
// 未显式传 taskListId 时用默认 id：单例「tasks mode」会话。

  // checkForTasks reads isLoading and onSubmitTask from refs — always
  // up-to-date, no stale closure, and doesn't force a new function identity
  // per render. Stored in a ref so the watcher effect can call it without
  // depending on it.
  const checkForTasksRef = useRef<() => Promise<void>>(async () => {})
// checkForTasks 也存 ref：effect 依赖里只有 [enabled, taskListId]，
// 函数身份变化不会重搭 watcher。
  checkForTasksRef.current = async () => {
    if (!enabled) {
      return
    }

    // Don't need to submit new tasks if we are already working
    if (isLoadingRef.current) {
      return
    }
// 正在干活不捡新任务：一次一个是本模式的铁律。

    const tasks = await listTasks(taskListId)

    // If we have a current task, check if it's been resolved
    if (currentTaskRef.current !== null) {
      const currentTask = tasks.find(t => t.id === currentTaskRef.current)
      if (!currentTask || currentTask.status === 'completed') {
        logForDebugging(
          `[TaskListWatcher] Task #${currentTaskRef.current} is marked complete, ready for next task`,
        )
        currentTaskRef.current = null
      } else {
        // Still working on current task
        return
      }
// 当前任务已被标 completed（或消失）→ 清 ref 准备捡下一个；
// 还在跑就 return，不并发。
    }

    // Find an open task with no owner that isn't blocked
    const availableTask = findAvailableTask(tasks)

    if (!availableTask) {
      return
    }
// 没有可捡的任务：安静返回，等下一个文件事件。

    logForDebugging(
      `[TaskListWatcher] Found available task #${availableTask.id}: ${availableTask.subject}`,
    )

    // Claim the task using the task list's agent ID
    const result = await claimTask(taskListId, availableTask.id, agentId)
// claimTask 是原子的（文件锁语义）：多个 watcher 可能同时看到
// 同一个开放任务，只有抢到锁的能继续。

    if (!result.success) {
      logForDebugging(
        `[TaskListWatcher] Failed to claim task #${availableTask.id}: ${result.reason}`,
      )
      return
    }
// 抢锁失败（被别人抢先）→ 记日志放弃，等下次事件。

    currentTaskRef.current = availableTask.id
// 先记 currentTask 再提交：提交是同步 bool，失败时下方负责释放。

    // Format the task as a prompt
    const prompt = formatTaskAsPrompt(availableTask)

    logForDebugging(
      `[TaskListWatcher] Submitting task #${availableTask.id} as prompt`,
    )

    const submitted = onSubmitTaskRef.current(prompt)
    if (!submitted) {
      logForDebugging(
        `[TaskListWatcher] Failed to submit task #${availableTask.id}, releasing claim`,
      )
      // Release the claim
      await updateTask(taskListId, availableTask.id, { owner: undefined })
// 提交被拒（REPL 忙/队列满）→ 主动释放 claim（owner 置 undefined），
// 否则这个任务会被永远卡在「有人认领但没人干」的状态。
      currentTaskRef.current = null
    }
// 释放后清 ref：下一次事件到达时可以重新捡起它。
  }

  // -- Watcher setup

  // Schedules a check after DEBOUNCE_MS, collapsing rapid fs events.
  // Shared between the watcher callback and the idle-trigger effect below.
// 去抖函数同时服务两个触发源：文件事件 + 下方「转空闲」effect。
// setTimeout 第三参直接传 ref，省一层闭包。
  const scheduleCheckRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!enabled) return

    void ensureTasksDir(taskListId)
    const tasksDir = getTasksDir(taskListId)

    let watcher: FSWatcher | null = null

    const debouncedCheck = (): void => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(
        ref => void ref.current(),
        DEBOUNCE_MS,
        checkForTasksRef,
      )
    }
// 把 debouncedCheck 存进 ref：空闲 effect 不需要依赖 watcher effect
// 的内部变量就能排一次检查。
    scheduleCheckRef.current = debouncedCheck

    try {
      watcher = watch(tasksDir, debouncedCheck)
      watcher.unref()
      logForDebugging(`[TaskListWatcher] Watching for tasks in ${tasksDir}`)
    } catch (error) {
      // fs.watch throws synchronously on ENOENT — ensureTasksDir should have
      // created the dir, but handle the race gracefully
      logForDebugging(`[TaskListWatcher] Failed to watch ${tasksDir}: ${error}`)
    }
// ensureTasksDir 应该已建好目录，但 watch 对「刚建好还没落盘」的
// ENOENT 是同步抛的——兜底记日志，不崩溃。

    // Initial check
    debouncedCheck()
// 挂载即检查一次：会话恢复时目录里可能已有排队任务。

    return () => {
      // This cleanup only fires when taskListId changes or on unmount —
      // never per-turn. That keeps watcher.close() out of the Bun
      // PathWatcherManager deadlock window.
      scheduleCheckRef.current = () => {}
      if (watcher) {
        watcher.close()
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
// 清理只在 taskListId 变化或卸载时发生——永不逐轮，
// 这是躲开 Bun PathWatcherManager 死锁窗口的关键。
  }, [enabled, taskListId])

  // Previously, the watcher effect depended on checkForTasks (and transitively
  // isLoading), so going idle triggered a re-setup whose initial debouncedCheck
  // would pick up the next task. Preserve that behavior explicitly: when
  // isLoading drops, schedule a check.
  useEffect(() => {
    if (!enabled) return
    if (isLoading) return
    scheduleCheckRef.current()
  }, [enabled, isLoading])
// 补偿效应：以前 watcher effect 依赖 checkForTasks（传递依赖 isLoading），
// 转空闲会顺带重搭 watcher 并触发一次检查。现在依赖剃掉后，
// 把「转空闲 → 排一次检查」显式写在这里，行为不变。
}

/**
 * Find an available task that can be worked on:
 * - Status is 'pending'
 * - No owner assigned
 * - Not blocked by any unresolved tasks
 */
function findAvailableTask(tasks: Task[]): Task | undefined {
  const unresolvedTaskIds = new Set(
    tasks.filter(t => t.status !== 'completed').map(t => t.id),
  )

  return tasks.find(task => {
    if (task.status !== 'pending') return false
    if (task.owner) return false
    // Check all blockers are completed
    return task.blockedBy.every(id => !unresolvedTaskIds.has(id))
  })
// 可捡任务三条件：pending + 无 owner + 所有 blockedBy 都已完成。
// 未完成 id 集合先算好，blockedBy.every 里查表是 O(1)。
}

/**
 * Format a task as a prompt for Claude to work on.
 */
function formatTaskAsPrompt(task: Task): string {
  let prompt = `Complete all open tasks. Start with task #${task.id}: \n\n ${task.subject}`

  if (task.description) {
    prompt += `\n\n${task.description}`
  }

  return prompt
// 提交 prompt 的拼法：固定开场白 + 任务号 + 主题 + 描述。
//「Complete all open tasks. Start with...」是给模型的排序暗示——
// 让它从这一个开始，而不是自己重排。
}
