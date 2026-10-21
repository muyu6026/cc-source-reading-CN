import { Event } from './event.js'

export type TerminalFocusEventType = 'terminalfocus' | 'terminalblur'

/**
 * Event fired when the terminal window gains or loses focus.
 *
 * Uses DECSET 1004 focus reporting - the terminal sends:
 * - CSI I (\x1b[I) when the terminal gains focus
 * - CSI O (\x1b[O) when the terminal loses focus
 */
// 与 FocusEvent 的区别别搞混：
//
//   FocusEvent          「组件之间」的焦点移动（Tab、点击聚焦）
//   TerminalFocusEvent  「终端窗口」整体的获焦/失焦（切到别的应用）
//
// 后者的来源是 DECSET 1004：终端在窗口获焦时发 CSI I、失焦时发 CSI O。
// 这两个序列由 App.tsx 的按键循环识别（第 472 / 478 行），不走
// Dispatcher —— 它们不是 DOM 事件，只是「两个特殊按键」。
//
// 用到它的地方主要是动画降速（ClockProvider 在失焦时把 tick 间隔
// 翻倍）和输入框的「失焦时不要抢键盘」。
export class TerminalFocusEvent extends Event {
  readonly type: TerminalFocusEventType

  constructor(type: TerminalFocusEventType) {
    super()
    this.type = type
  }
}
