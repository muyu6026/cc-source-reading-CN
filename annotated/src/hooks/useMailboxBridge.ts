import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useMailbox } from '../context/mailbox.js'

type Props = {
  isLoading: boolean
  onSubmitMessage: (content: string) => boolean
}

export function useMailboxBridge({ isLoading, onSubmitMessage }: Props): void {
// 桥接邮箱：把外部 mailbox 的消息在 REPL 非加载态时投递给输入框（onSubmitMessage）。
  const mailbox = useMailbox()

  const subscribe = useMemo(() => mailbox.subscribe.bind(mailbox), [mailbox])
  const getSnapshot = useCallback(() => mailbox.revision, [mailbox])
  const revision = useSyncExternalStore(subscribe, getSnapshot)
// 用 useSyncExternalStore 订阅 mailbox.revision：队列变化才重渲染，避免无意义刷新。

  useEffect(() => {
    if (isLoading) return
    const msg = mailbox.poll()
// 加载中不打扰；否则 poll 取一条消息并投递，通常由邮件/外部指令注入。
    if (msg) onSubmitMessage(msg.content)
  }, [isLoading, revision, mailbox, onSubmitMessage])
}
