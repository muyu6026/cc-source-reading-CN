import { useEffect, useState } from 'react'

export function useTimeout(delay: number, resetTrigger?: number): boolean {
// 延时 hook：delay 毫秒后把 isElapsed 翻 true；resetTrigger 变化会重置计时器（再次开始计时）。
  const [isElapsed, setIsElapsed] = useState(false)

  useEffect(() => {
    setIsElapsed(false)
    const timer = setTimeout(setIsElapsed, delay, true)
// 每次 effect 先复位为 false 再起计时器；delay / resetTrigger 变化时清理旧计时器重来。

    return () => clearTimeout(timer)
  }, [delay, resetTrigger])

  return isElapsed
}
