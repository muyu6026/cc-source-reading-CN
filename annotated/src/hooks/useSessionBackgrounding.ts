/**
 * Hook for managing session backgrounding (Ctrl+B to background/foreground sessions).
 *
 * Handles:
 * - Calling onBackgroundQuery to spawn a background task for the current query
 * - Re-backgrounding foregrounded tasks
 * - Syncing foregrounded task messages/state to main view
 */

import { useCallback, useEffect, useRef } from 'react'
import { useAppState, useSetAppState } from '../state/AppState.js'
import type { Message } from '../types/message.js'

type UseSessionBackgroundingProps = {
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void
  setIsLoading: (loading: boolean) => void
  resetLoadingState: () => void
  setAbortController: (controller: AbortController | null) => void
  onBackgroundQuery: () => void
}

type UseSessionBackgroundingResult = {
  /** Call when user wants to background (Ctrl+B) */
  handleBackgroundSession: () => void
}

export function useSessionBackgrounding({
  setMessages,
  setIsLoading,
  resetLoadingState,
  setAbortController,
  onBackgroundQuery,
}: UseSessionBackgroundingProps): UseSessionBackgroundingResult {
// 返回唯一的挂起处理函数：Ctrl+B 把当前会话挂后台或把前台会话重新挂起。
  const foregroundedTaskId = useAppState(s => s.foregroundedTaskId)
  const foregroundedTask = useAppState(s =>
    s.foregroundedTaskId ? s.tasks[s.foregroundedTaskId] : undefined,
  )
  const setAppState = useSetAppState()
  const lastSyncedMessagesLengthRef = useRef<number>(0)

  const handleBackgroundSession = useCallback(() => {
// Ctrl+B 入口：若已有 foregroundedTaskId（正在前台查看某后台任务），
// 则重新挂起它；否则发起一次后台查询（onBackgroundQuery）。
    if (foregroundedTaskId) {
      // Re-background the foregrounded task
      setAppState(prev => {
        const taskId = prev.foregroundedTaskId
        if (!taskId) return prev
        const task = prev.tasks[taskId]
        if (!task) {
          return { ...prev, foregroundedTaskId: undefined }
        }
        return {
          ...prev,
          foregroundedTaskId: undefined,
          tasks: {
            ...prev.tasks,
            [taskId]: { ...task, isBackgrounded: true },
          },
        }
      })
      setMessages([])
// 重新挂起后清空主视图的消息、loading 态与 abort 控制器，
// 让前台视图回到空闲。
      resetLoadingState()
      setAbortController(null)
      return
    }

    onBackgroundQuery()
  }, [
    foregroundedTaskId,
    setAppState,
    setMessages,
    resetLoadingState,
    setAbortController,
    onBackgroundQuery,
  ])

  // Sync foregrounded task's messages and loading state to the main view
  useEffect(() => {
    if (!foregroundedTaskId) {
      // Reset when no foregrounded task
      lastSyncedMessagesLengthRef.current = 0
      return
    }

    if (!foregroundedTask || foregroundedTask.type !== 'local_agent') {
      setAppState(prev => ({ ...prev, foregroundedTaskId: undefined }))
      resetLoadingState()
      lastSyncedMessagesLengthRef.current = 0
      return
    }
// 没有前台任务、或前台任务不是 local_agent 类型时，
// 直接清前台态并重置消息同步游标。

    // Sync messages from background task to main view
    // Only update if messages have actually changed to avoid redundant renders
    const taskMessages = foregroundedTask.messages ?? []
    if (taskMessages.length !== lastSyncedMessagesLengthRef.current) {
      lastSyncedMessagesLengthRef.current = taskMessages.length
      setMessages([...taskMessages])
    }
// 仅当后台任务消息数量真正变化时才回写主视图，
// 避免每轮 effect 都触发冗余渲染。

    if (foregroundedTask.status === 'running') {
      // Check if the task was aborted (user pressed Escape)
      const taskAbortController = foregroundedTask.abortController
      if (taskAbortController?.signal.aborted) {
        // Task was aborted - clear foregrounded state immediately
        setAppState(prev => {
          if (!prev.foregroundedTaskId) return prev
          const task = prev.tasks[prev.foregroundedTaskId]
          if (!task) return { ...prev, foregroundedTaskId: undefined }
          return {
            ...prev,
            foregroundedTaskId: undefined,
            tasks: {
              ...prev.tasks,
              [prev.foregroundedTaskId]: { ...task, isBackgrounded: true },
            },
          }
        })
        resetLoadingState()
        setAbortController(null)
        lastSyncedMessagesLengthRef.current = 0
        return
      }
// 运行中的任务检测 Escape 中止信号（abortController.signal.aborted），
// 一旦中止立即清前台态，把控制权交还用户。

      setIsLoading(true)
      // Set abort controller to the foregrounded task's controller for Escape handling
      if (taskAbortController) {
        setAbortController(taskAbortController)
      }
// 任务仍在运行：主视图进入 loading，并把 abort 控制器
// 切换为前台任务自己的控制器，使 Escape 能中止后台任务。
    } else {
      // Task completed - restore to background and clear foregrounded view
      setAppState(prev => {
        const taskId = prev.foregroundedTaskId
        if (!taskId) return prev
        const task = prev.tasks[taskId]
        if (!task) return { ...prev, foregroundedTaskId: undefined }
        return {
          ...prev,
          foregroundedTaskId: undefined,
          tasks: { ...prev.tasks, [taskId]: { ...task, isBackgrounded: true } },
        }
      })
      resetLoadingState()
      setAbortController(null)
      lastSyncedMessagesLengthRef.current = 0
    }
  }, [
    foregroundedTaskId,
    foregroundedTask,
    setAppState,
    setMessages,
    setIsLoading,
    resetLoadingState,
    setAbortController,
  ])

  return {
    handleBackgroundSession,
  }
}
