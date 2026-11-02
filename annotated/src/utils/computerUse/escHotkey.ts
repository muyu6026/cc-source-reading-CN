// 全局 Escape 键映射为中止。做法是注册系统级事件监听，注册期间 Escape 被全局吞掉——这同时是一道防线：被提示注入的动作没法用 Escape 去关掉对话框。生命周期挂在计算机操控锁上：拿到锁时注册，释放锁时注销。
import { logForDebugging } from '../debug.js'
import { releasePump, retainPump } from './drainRunLoop.js'
import { requireComputerUseSwift } from './swiftLoader.js'

/**
 * Global Escape → abort. Mirrors Cowork's `escAbort.ts` but without Electron:
 * CGEventTap via `@ant/computer-use-swift`. While registered, Escape is
 * consumed system-wide (PI defense — a prompt-injected action can't dismiss
 * a dialog with Escape).
 *
 * Lifecycle: register on fresh lock acquire (`wrapper.tsx` `acquireCuLock`),
 * unregister on lock release (`cleanup.ts`). The tap's CFRunLoopSource sits
 * in .defaultMode on CFRunLoopGetMain(), so we hold a drainRunLoop pump
 * retain for the registration's lifetime — same refcounted setInterval as
 * the `@MainActor` methods.
 *
 * `notifyExpectedEscape()` punches a hole for model-synthesized Escapes: the
 * executor's `key("escape")` calls it before posting the CGEvent. Swift
 * schedules a 100ms decay so a CGEvent that never reaches the tap callback
 * doesn't eat the next user ESC.
 */

let registered = false
// 注册状态用一个模块级布尔表示，因为系统级监听本身就是全局唯一的资源，不需要计数。重复注册直接返回真，避免第二次注册覆盖掉第一次的回调。

export function registerEscHotkey(onEscape: () => void): boolean {
  if (registered) return true
  const cu = requireComputerUseSwift()
  if (!cu.hotkey.registerEscape(onEscape)) {
    // CGEvent.tapCreate failed — typically missing Accessibility permission.
    // CU still works, just without ESC abort. Mirrors Cowork's escAbort.ts:81.
    logForDebugging('[cu-esc] registerEscape returned false', { level: 'warn' })
    return false
  }
  retainPump()
  registered = true
  logForDebugging('[cu-esc] registered')
  return true
}
// 注册失败不抛错，只记一条告警并返回假：监听创建失败通常是缺辅助功能权限，但计算机操控的其他能力仍然可用，所以这里必须降级而不是让整条链路失败。注册成功后才持有抽干泵的引用——因为监听的回调也排在主队列上，没有泵就永远收不到事件。

export function unregisterEscHotkey(): void {
  if (!registered) return
  try {
    requireComputerUseSwift().hotkey.unregister()
  } finally {
    releasePump()
    registered = false
    logForDebugging('[cu-esc] unregistered')
  }
}
// 注销用 try 与 finally 组合：先尝试注销原生监听，无论成功与否都释放泵引用并清状态。这个顺序很重要，如果原生注销抛错而泵没释放，进程就会带着一个永不停止的定时器继续跑。

export function notifyExpectedEscape(): void {
  if (!registered) return
  requireComputerUseSwift().hotkey.notifyExpectedEscape()
}
// 这个函数给「模型自己合成的按键」开一孔：执行器在投递事件前先通报一声，原生侧据此短暂放过紧随其后的一次 Escape，避免模型自己发出的键被自己的防线吞掉。未注册时直接返回，不做任何原生调用。
