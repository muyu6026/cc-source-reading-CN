import { useCallback, useRef, useState } from 'react'
import type { PastedContent } from '../utils/config.js'

export type BufferEntry = {
  text: string
  cursorOffset: number
  pastedContents: Record<number, PastedContent>
  timestamp: number
}

export type UseInputBufferProps = {
  maxBufferSize: number
  debounceMs: number
}

export type UseInputBufferResult = {
  pushToBuffer: (
    text: string,
    cursorOffset: number,
    pastedContents?: Record<number, PastedContent>,
  ) => void
  undo: () => BufferEntry | undefined
  canUndo: boolean
  clearBuffer: () => void
}

export function useInputBuffer({
  maxBufferSize,
  debounceMs,
}: UseInputBufferProps): UseInputBufferResult {
  const [buffer, setBuffer] = useState<BufferEntry[]>([])
// buffer 保存历史输入快照，currentIndex 指向当前所处的快照位置（支持撤销）。
  const [currentIndex, setCurrentIndex] = useState(-1)
  const lastPushTime = useRef<number>(0)
  const pendingPush = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pushToBuffer = useCallback(
    (
      text: string,
      cursorOffset: number,
      pastedContents: Record<number, PastedContent> = {},
    ) => {
      const now = Date.now()

      // Clear any pending push
      if (pendingPush.current) {
        clearTimeout(pendingPush.current)
        pendingPush.current = null
      }

      // Debounce rapid changes
      if (now - lastPushTime.current < debounceMs) {
        pendingPush.current = setTimeout(
          pushToBuffer,
          debounceMs,
          text,
          cursorOffset,
          pastedContents,
        )
        return
      }
// debounce 快速连续变更：未超过 debounceMs 的输入合并到下一次定时器，
// 不立即入栈，降低高频打字时的缓冲抖动。

      lastPushTime.current = now

      setBuffer(prevBuffer => {
        // If we're not at the end of the buffer, truncate everything after current position
        const newBuffer =
          currentIndex >= 0 ? prevBuffer.slice(0, currentIndex + 1) : prevBuffer

        // Don't add if it's the same as the last entry
        const lastEntry = newBuffer[newBuffer.length - 1]
        if (lastEntry && lastEntry.text === text) {
          return newBuffer
        }

        // Add new entry
        const updatedBuffer = [
          ...newBuffer,
          { text, cursorOffset, pastedContents, timestamp: now },
        ]

        // Limit buffer size
        if (updatedBuffer.length > maxBufferSize) {
          return updatedBuffer.slice(-maxBufferSize)
        }

        return updatedBuffer
      })
// 入栈前：若不在末尾则截断未来（撤销后再输入即新分支）、
// 与末条相同则跳过、超出上限则只保留最近 maxBufferSize 条。

      // Update current index to point to the new entry
      setCurrentIndex(prev => {
        const newIndex = prev >= 0 ? prev + 1 : buffer.length
        return Math.min(newIndex, maxBufferSize - 1)
      })
// 更新 currentIndex 指向新条目；不在末尾时顺延 +1，否则追加到 buffer 长度处。
    },
    [debounceMs, maxBufferSize, currentIndex, buffer.length],
  )

  const undo = useCallback((): BufferEntry | undefined => {
    if (currentIndex < 0 || buffer.length === 0) {
      return undefined
    }

    const targetIndex = Math.max(0, currentIndex - 1)
    const entry = buffer[targetIndex]

    if (entry) {
      setCurrentIndex(targetIndex)
      return entry
    }

    return undefined
  }, [buffer, currentIndex])
// undo 回退到上一条快照（currentIndex-1），返回该条目供上层还原输入。

  const clearBuffer = useCallback(() => {
    setBuffer([])
    setCurrentIndex(-1)
    lastPushTime.current = 0
    if (pendingPush.current) {
      clearTimeout(pendingPush.current)
      pendingPush.current = null
    }
  }, [lastPushTime, pendingPush])

  const canUndo = currentIndex > 0 && buffer.length > 1
// canUndo：至少有 2 条且不在首条时才允许撤销。

  return {
    pushToBuffer,
    undo,
    canUndo,
    clearBuffer,
  }
}
