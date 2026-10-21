// ═══════════════════════════════════════════════════════════════
//  终端通知：绕开渲染器直接写 stdout
// ═══════════════════════════════════════════════════════════════
//
//  这里的 `writeRaw` 来自 `TerminalWriteContext`，由 `ink.tsx:1445`
//  注入 —— 它是 Ink 实例上的原始写函数，**不经过 diff、不经过光标模型**。
//
//  为什么必须绕开：通知（OSC 9 / OSC 777 / OSC 9;4）是终端自己处理的
//  控制序列，不该进屏幕缓冲。如果走正常渲染路径，它们会被当成字面
//  文本画在屏幕上（或者污染 patch 队列）。
//
//  这是 TUI 里一个通用的分界线：
//
//    **看得见的东西** → 进屏幕缓冲，走 diff
//    **给终端本身的东西** → 直写 stdout，绕开一切
//
//  后者包括：通知、进度、标题、剪贴板、DEC 模式切换、同步输出标记。
import { createContext, useCallback, useContext, useMemo } from 'react'
import { isProgressReportingAvailable, type Progress } from './terminal.js'
import { BEL } from './termio/ansi.js'
import { ITERM2, OSC, osc, PROGRESS, wrapForMultiplexer } from './termio/osc.js'

type WriteRaw = (data: string) => void

// 默认值是 `null` 而不是 `noop` —— 于是「不在 Provider 里」可以被
//  检测到（第 27 行抛错），而不是静默什么都不做。
//
//  这个选择在库代码里很重要：静默失败会让「通知没弹出来」变成一个
//  很难查的问题（是终端不支持？还是没挂 Provider？）。
export const TerminalWriteContext = createContext<WriteRaw | null>(null)

export const TerminalWriteProvider = TerminalWriteContext.Provider

// 五种通知能力，正好对应五种终端/协议：
//   notifyITerm2   OSC 9
//   notifyKitty    OSC 99（分三条：标题、正文、焦点动作）
//   notifyGhostty  OSC 777
//   notifyBell     裸 BEL（最古老的兜底）
//   progress       OSC 9;4（任务栏/标签页进度）
//
//  注意这些 API 都是「尽力而为」：调了不一定有效果，而且**没有回执**。
//  所以调用方不能等，也不能依赖。
export type TerminalNotification = {
  notifyITerm2: (opts: { message: string; title?: string }) => void
  notifyKitty: (opts: { message: string; title: string; id: number }) => void
  notifyGhostty: (opts: { message: string; title: string }) => void
  notifyBell: () => void
  /**
   * Report progress to the terminal via OSC 9;4 sequences.
   * Supported terminals: ConEmu, Ghostty 1.2.0+, iTerm2 3.6.6+
   * Pass state=null to clear progress.
   */
  progress: (state: Progress['state'] | null, percentage?: number) => void
}

export function useTerminalNotification(): TerminalNotification {
  const writeRaw = useContext(TerminalWriteContext)
  if (!writeRaw) {
    throw new Error(
      'useTerminalNotification must be used within TerminalWriteProvider',
    )
  }

  const notifyITerm2 = useCallback(
    ({ message, title }: { message: string; title?: string }) => {
      const displayString = title ? `${title}:\n${message}` : message
// iTerm2 的 OSC 9 格式是 `ESC ] 9 ; 内容 BEL`，内容里的换行
//  （`\n\n`）用来把标题和正文分开。
//
//  `wrapForMultiplexer` 是关键的一步：在 tmux / screen 里，
//  外层要先用 DCS 包裹才算「透传给内层终端」。不包的话，
//  序列会被 tmux 自己吃掉（它以为那是给它的）。
      writeRaw(wrapForMultiplexer(osc(OSC.ITERM2, `\n\n${displayString}`)))
    },
    [writeRaw],
  )

// Kitty 的通知要在**三条** OSC 里完成：
//   `i=<id>:d=0:p=title`  —— 声明这个通知（id 用于去重/更新）
//   `i=<id>:p=body`       —— 正文
//   `i=<id>:d=1:a=focus`  —— 收尾 + 焦点时的动作
//
//  分三条而不是一条，是 Kitty 协议的设计（允许流式更新一个通知）。
//  代价是三次 writeRaw —— 在 tmux 里就是三层 DCS 包裹。
  const notifyKitty = useCallback(
    ({
      message,
      title,
      id,
    }: {
      message: string
      title: string
      id: number
    }) => {
      writeRaw(wrapForMultiplexer(osc(OSC.KITTY, `i=${id}:d=0:p=title`, title)))
      writeRaw(wrapForMultiplexer(osc(OSC.KITTY, `i=${id}:p=body`, message)))
      writeRaw(wrapForMultiplexer(osc(OSC.KITTY, `i=${id}:d=1:a=focus`, '')))
    },
    [writeRaw],
  )

  const notifyGhostty = useCallback(
    ({ message, title }: { message: string; title: string }) => {
      writeRaw(wrapForMultiplexer(osc(OSC.GHOSTTY, 'notify', title, message)))
    },
    [writeRaw],
  )

// 这一处**故意不包**，注释讲得很清楚：裸 BEL 在 tmux 里会触发
//  tmux 自己的 `bell-action`（窗口标记/声音）。
//
//  包成 DCS 的话，tmux 只看到一段不透明的负载，转发给外层终端 ——
//  于是「tmux 的提醒机制」被绕过了，而用户可能正看着另一个 tmux 窗口。
//
//  这是一个很好的反例：**「总是包起来」不是普适规则**。包的目的是
//  「让序列到达内层终端」，但当中间层本身就该响应这个序列时，
//  不包才是对的。
  const notifyBell = useCallback(() => {
    // Raw BEL — inside tmux this triggers tmux's bell-action (window flag).
    // Wrapping would make it opaque DCS payload and lose that fallback.
    writeRaw(BEL)
  }, [writeRaw])

// 进度上报有个前提检查（`isProgressReportingAvailable`），
//  其余四种通知**没有** —— 因为它们无害：不支持的终端会忽略未知 OSC。
//
//  而 OSC 9;4 在 Windows Terminal 里会被当成**通知**（弹一条消息），
//  所以必须精确判断。这是「同一个序列在不同终端里语义不同」的
//  典型例子 —— 也是 `terminal.ts` 里那段排除逻辑的动机。
  const progress = useCallback(
    (state: Progress['state'] | null, percentage?: number) => {
      if (!isProgressReportingAvailable()) {
        return
      }
      if (!state) {
        writeRaw(
          wrapForMultiplexer(
            osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.CLEAR, ''),
          ),
        )
        return
      }
// 百分比先钳到 [0, 100] 再取整。顺序是先 `Math.round` 还是先 `clamp`
//  有细微差别：先 round 再 clamp 会让 100.4 变成 100（正确），
//  先 clamp 再 round 也一样。这里写成 `clamp(round(x))`，两步都对。
//
//  `percentage ?? 0`：不给就报 0。对 `running` 状态意味着「0%」，
//  而不是「不确定」—— 不确定要走 `indeterminate`。
      const pct = Math.max(0, Math.min(100, Math.round(percentage ?? 0)))
      switch (state) {
// `completed` 映射成 **CLEAR** 而不是「100%」。
//
//  这是协议层面的选择：OSC 9;4 的 state=0（清除）会让进度条**消失**，
//  而 state=1 + 100 会让它**停在那儿**。任务完成后让进度条消失更像
//  原生应用的行为（否则窗口标题上永远挂着一条满格的进度）。
//
//  这个细节说明：写这类「向宿主报告状态」的代码时，要想清楚
//  「结束」是「完成态」还是「回到无状态」。
        case 'completed':
          writeRaw(
            wrapForMultiplexer(
              osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.CLEAR, ''),
            ),
          )
          break
        case 'error':
          writeRaw(
            wrapForMultiplexer(
              osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.ERROR, pct),
            ),
          )
          break
        case 'indeterminate':
          writeRaw(
            wrapForMultiplexer(
              osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.INDETERMINATE, ''),
            ),
          )
          break
        case 'running':
          writeRaw(
            wrapForMultiplexer(
              osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.SET, pct),
            ),
          )
          break
// `case null` 分支永远不会执行 —— 因为第 76 行的 `if (!state)` 已经
//  return 了。
//
//  它存在只是为了**穷尽性**：TypeScript 会对 `switch` 的联合类型
//  做检查，少一个 case 不报错但会让人不安。留一个空分支 + 注释
//  说明「上面处理过了」，比留一个 `default` 更明确（default 会
//  掩盖将来新增的 state 值）。
//
//  这是「用 switch 穷尽联合类型」的常见代价：早退的路径让 switch
//  无法真实覆盖。另一种写法是先 switch 再处理，但那样重复更多。
        case null:
          // Handled by the if guard above
          break
      }
    },
    [writeRaw],
  )

  return useMemo(
    () => ({ notifyITerm2, notifyKitty, notifyGhostty, notifyBell, progress }),
    [notifyITerm2, notifyKitty, notifyGhostty, notifyBell, progress],
  )
}
