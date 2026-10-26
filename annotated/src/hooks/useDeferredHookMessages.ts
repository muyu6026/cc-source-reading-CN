import { useCallback, useEffect, useRef } from 'react'
import type { HookResultMessage, Message } from '../types/message.js'

/**
 * Manages deferred SessionStart hook messages so the REPL can render
 * immediately instead of blocking on hook execution (~500ms).
 *
 * Hook messages are injected asynchronously when the promise resolves.
 * Returns a callback that onSubmit should call before the first API
 * request to ensure the model always sees hook context.
 */
// 把 SessionStart 等延迟 hook 消息「先渲染后注入」，避免 REPL 阻塞在 hook 执行（约 500ms）。
export function useDeferredHookMessages(
  pendingHookMessages: Promise<HookResultMessage[]> | undefined,
  setMessages: (action: React.SetStateAction<Message[]>) => void,
): () => Promise<void> {
  const pendingRef = useRef(pendingHookMessages ?? null)
// 两个 ref：pendingRef 持有未决 promise，resolvedRef 标记是否已结算（决定回调是否还要等）。
  const resolvedRef = useRef(!pendingHookMessages)

  useEffect(() => {
    const promise = pendingRef.current
    if (!promise) return
    let cancelled = false
    promise.then(msgs => {
      if (cancelled) return
      resolvedRef.current = true
      pendingRef.current = null
      if (msgs.length > 0) {
        setMessages(prev => [...msgs, ...prev])
// promise 结算后把消息前置插入对话（[...msgs, ...prev]），确保模型首轮就能看到 hook 上下文。
      }
    })
    return () => {
      cancelled = true
    }
  }, [setMessages])

  return useCallback(async () => {
    if (resolvedRef.current || !pendingRef.current) return
    const msgs = await pendingRef.current
// 返回的回调供 onSubmit 在首个 API 请求前调用：已结算或无可等则直接返回，否则 await 后注入。
    if (resolvedRef.current) return
    resolvedRef.current = true
    pendingRef.current = null
    if (msgs.length > 0) {
      setMessages(prev => [...msgs, ...prev])
    }
  }, [setMessages])
}
