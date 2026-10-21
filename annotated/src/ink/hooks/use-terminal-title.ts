import { useContext, useEffect } from 'react'
import stripAnsi from 'strip-ansi'
import { OSC, osc } from '../termio/osc.js'
import { TerminalWriteContext } from '../useTerminalNotification.js'

/**
 * Declaratively set the terminal tab/window title.
 *
 * Pass a string to set the title. ANSI escape sequences are stripped
 * automatically so callers don't need to know about terminal encoding.
 * Pass `null` to opt out — the hook becomes a no-op and leaves the
 * terminal title untouched.
 *
 * On Windows, uses `process.title` (classic conhost doesn't support OSC).
 * Elsewhere, writes OSC 0 (set title+icon) via Ink's stdout.
 */
// 两个平台两套机制，因为 Windows 的经典控制台（conhost）不解析 OSC：
//
//   POSIX  写 OSC 0（同时设标题和图标名）到 stdout
//   win32  直接改 process.title
//
// stripAnsi 是防御性的：标题里带颜色码的话，OSC 的参数里再嵌一个 ESC
// 会把序列提前截断，之后的内容就变成「终端上乱码 + 原来的标题没设上」。
// 调用方不该关心编码，所以在这里统一洗干净。
export function useTerminalTitle(title: string | null): void {
  const writeRaw = useContext(TerminalWriteContext)

  useEffect(() => {
    if (title === null || !writeRaw) return

    const clean = stripAnsi(title)

    if (process.platform === 'win32') {
      process.title = clean
    } else {
      writeRaw(osc(OSC.SET_TITLE_AND_ICON, clean))
    }
  }, [title, writeRaw])
// 没有 cleanup —— 组件卸载后标题**保持最后设置的值**，不会恢复。
//
// 这是有意的（恢复成什么？进程启动时的标题已经拿不到了），
// 但意味着「临时改标题的组件」需要自己记得在卸载时再调一次
// useTerminalTitle(原值)。REPL 那边是靠上层算 title 时把各种状态
// 拼进去，而不是让每处各改各的。
}
