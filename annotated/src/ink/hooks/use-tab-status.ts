import { useContext, useEffect, useRef } from 'react'
import {
  CLEAR_TAB_STATUS,
  supportsTabStatus,
  tabStatus,
  wrapForMultiplexer,
} from '../termio/osc.js'
import type { Color } from '../termio/types.js'
import { TerminalWriteContext } from '../useTerminalNotification.js'

export type TabStatusKind = 'idle' | 'busy' | 'waiting'

const rgb = (r: number, g: number, b: number): Color => ({
  type: 'rgb',
  r,
  g,
  b,
})

// Per the OSC 21337 usage guide's suggested mapping.
const TAB_STATUS_PRESETS: Record<
  TabStatusKind,
  { indicator: Color; status: string; statusColor: Color }
> = {
  idle: {
    indicator: rgb(0, 215, 95),
    status: 'Idle',
    statusColor: rgb(136, 136, 136),
  },
  busy: {
    indicator: rgb(255, 149, 0),
    status: 'Working…',
    statusColor: rgb(255, 149, 0),
  },
  waiting: {
    indicator: rgb(95, 135, 255),
    status: 'Waiting',
    statusColor: rgb(95, 135, 255),
  },
}

/**
 * Declaratively set the tab-status indicator (OSC 21337).
 *
 * Emits a colored dot + short status text to the tab sidebar. Terminals
 * that don't support OSC 21337 discard the sequence silently, so this is
 * safe to call unconditionally. Wrapped for tmux/screen passthrough.
 *
 * Pass `null` to opt out. If a status was previously set, transitioning to
 * `null` emits CLEAR_TAB_STATUS so toggling off mid-session doesn't leave
 * a stale dot. Process-exit cleanup is handled by ink.tsx's unmount path.
 */
// OSC 21337 是「标签页状态」的私有协议（终端在标签上画一个小圆点 +
// 一行短文字）。不支持的终端直接丢弃这个序列，所以可以无条件发。
//
// 三个预设值对应「空闲 / 工作中 / 等待输入」，配色取自协议文档的建议值。
// 这属于「终端能力探测」那条线的另一端：不需要探测，因为**发错了
// 也没有代价** —— 和 terminal.ts 里那些需要白名单的能力正好相反。
export function useTabStatus(kind: TabStatusKind | null): void {
  const writeRaw = useContext(TerminalWriteContext)
  const prevKindRef = useRef<TabStatusKind | null>(null)

  useEffect(() => {
    // When kind transitions from non-null to null (e.g. user toggles off
    // showStatusInTerminalTab mid-session), clear the stale dot.
    if (kind === null) {
      if (prevKindRef.current !== null && writeRaw && supportsTabStatus()) {
        writeRaw(wrapForMultiplexer(CLEAR_TAB_STATUS))
      }
      prevKindRef.current = null
      return
    }
// prevKindRef 的唯一用途：区分「从来就没设过」和「之前设过、现在关掉」。
// 只有后者才需要发 CLEAR，否则每次组件挂载都多发一条清空序列。
//
// 这是声明式接口的常见模式 —— 组件说「我要什么状态」，hook 负责把
// 「状态之间的转移」翻译成副作用。

    prevKindRef.current = kind
    if (!writeRaw || !supportsTabStatus()) return
// 注意 prevKindRef 在第 68 行（本行之前）就已经更新了，**早于**
// supportsTabStatus() 的判断。所以即使终端不支持、什么都没写，
// prevKind 仍然记着「曾经想要这个状态」—— 之后切到 null 时会尝试
// 发一条 CLEAR（同样被终端丢弃，无害）。
//
// 如果顺序反过来（先判支持再记 prevKind），一个在不支持 OSC 21337
// 的终端上切来切去的用户，永远不会发 CLEAR —— 也无所谓，因为他
// 从来没成功设过。两种写法都自洽，这里选的是「记录意图」而不是
// 「记录事实」。
    writeRaw(wrapForMultiplexer(tabStatus(TAB_STATUS_PRESETS[kind])))
  }, [kind, writeRaw])
}
