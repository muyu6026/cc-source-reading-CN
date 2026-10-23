import { useEffect, useRef } from 'react'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import {
  type Notification,
  useNotifications,
} from '../../context/notifications.js'
import { useAppState } from '../../state/AppState.js'
import { isInProcessTeammateTask } from '../../tasks/InProcessTeammateTask/types.js'

// 从通知文案头部解析数量（「3 agents spawned」→ 3），
// 用于 fold 累加；解析失败按 1 计。
function parseCount(notif: Notification): number {
  if (!('text' in notif)) {
    return 1
  }
  const match = notif.text.match(/^(\d+)/)
  return match?.[1] ? parseInt(match[1], 10) : 1
}

// fold 回调：新事件到来时把累计数 +1 重新生成通知，
// 由通知系统的 fold 机制调用（同 key 通知自动合并而非堆叠）。
function foldSpawn(acc: Notification, _incoming: Notification): Notification {
  return makeSpawnNotif(parseCount(acc) + 1)
}

// 生成/刷新 spawn 通知：单复数切换 + 5s 自动消失 + fold 自引用。
function makeSpawnNotif(count: number): Notification {
  return {
    key: 'teammate-spawn',
    text: count === 1 ? '1 agent spawned' : `${count} agents spawned`,
    priority: 'low',
    timeoutMs: 5000,
    fold: foldSpawn,
  }
}

function foldShutdown(
  acc: Notification,
  _incoming: Notification,
): Notification {
  return makeShutdownNotif(parseCount(acc) + 1)
}

function makeShutdownNotif(count: number): Notification {
  return {
    key: 'teammate-shutdown',
    text: count === 1 ? '1 agent shut down' : `${count} agents shut down`,
    priority: 'low',
    timeoutMs: 5000,
    fold: foldShutdown,
  }
}

/**
 * Fires batched notifications when in-process teammates spawn or shut down.
 * Uses fold() to combine repeated events into a single notification
 * like "3 agents spawned" or "2 agents shut down".
 */
// 队友任务开始/完成时批量提示。用 fold() 把连续事件合并成
// 一条（「3 agents spawned」），避免每个队友弹一次刷屏。
export function useTeammateLifecycleNotification(): void {
// 两个 seen Set 记录已报过 id：running 与 completed 各一个，
// 保证同一任务只触发一次 spawn 和一次 shutdown 通知。
  const tasks = useAppState(s => s.tasks)
  const { addNotification } = useNotifications()
  const seenRunningRef = useRef<Set<string>>(new Set())
  const seenCompletedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (getIsRemoteMode()) return
    for (const [id, task] of Object.entries(tasks)) {
      if (!isInProcessTeammateTask(task)) {
        continue
      }

// 新出现的 running 任务 → spawn 通知（addNotification
// 撞上同 key 现有通知时走 fold 累加）。
      if (task.status === 'running' && !seenRunningRef.current.has(id)) {
        seenRunningRef.current.add(id)
        addNotification(makeSpawnNotif(1))
      }

// 新出现的 completed 任务 → shutdown 通知，同样走 fold。
      if (task.status === 'completed' && !seenCompletedRef.current.has(id)) {
        seenCompletedRef.current.add(id)
        addNotification(makeShutdownNotif(1))
      }
    }
  }, [tasks, addNotification])
}
