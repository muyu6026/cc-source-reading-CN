import type { ToolUseContext } from '../../Tool.js'
// 计算机操控的回合收尾：把本轮临时隐藏的应用恢复显示，再释放那把文件锁。三个调用点分别覆盖正常结束、流式中止、工具执行中止。

import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { withResolvers } from '../withResolvers.js'
import { isLockHeldLocally, releaseComputerUseLock } from './computerUseLock.js'
import { unregisterEscHotkey } from './escHotkey.js'

// cu.apps.unhide is NOT one of the four @MainActor methods wrapped by
// drainRunLoop's 30s backstop. On abort paths (where the user hit Ctrl+C
// because something was slow) a hang here would wedge the abort. Generous
// timeout — unhide should be ~instant; if it takes 5s something is wrong
// and proceeding is better than waiting. The Swift call continues in the
// background regardless; we just stop blocking on it.
const UNHIDE_TIMEOUT_MS = 5000
// unhide 超时给到 5 秒：它不在此前那四个带 30 秒兜底的 Swift 主线程方法之内，一旦卡住会把「因为慢才按 Ctrl+C」的中止路径整个拖死。5 秒还没回来就当异常，先放行流程。

/**
 * Turn-end cleanup for the chicago MCP surface: auto-unhide apps that
 * `prepareForAction` hid, then release the file-based lock.
 *
 * Called from three sites: natural turn end (`stopHooks.ts`), abort during
 * streaming (`query.ts` aborted_streaming), abort during tool execution
 * (`query.ts` aborted_tools). All three reach this via dynamic import gated
 * on `feature('CHICAGO_MCP')`. `executor.js` (which pulls both native
 * modules) is dynamic-imported below so non-CU turns don't load native
 * modules just to no-op.
 *
 * No-ops cheaply on non-CU turns: both gate checks are zero-syscall.
 */
export async function cleanupComputerUseAfterTurn(
  ctx: Pick<
    ToolUseContext,
    'getAppState' | 'setAppState' | 'sendOSNotification'
  >,
): Promise<void> {
  const appState = ctx.getAppState()
// 先取一次应用状态快照：下面两个判断都基于同一份状态，避免中途被其他回合改掉导致前后不一致。

  const hidden = appState.computerUseMcpState?.hiddenDuringTurn
  if (hidden && hidden.size > 0) {
    const { unhideComputerUseApps } = await import('./executor.js')
    const unhide = unhideComputerUseApps([...hidden]).catch(err =>
      logForDebugging(
        `[Computer Use MCP] auto-unhide failed: ${errorMessage(err)}`,
      ),
    )
    const timeout = withResolvers<void>()
    const timer = setTimeout(timeout.resolve, UNHIDE_TIMEOUT_MS)
    await Promise.race([unhide, timeout.promise]).finally(() =>
      clearTimeout(timer),
    )
// 竞速加 finally 清定时器：Swift 侧调用照旧在后台跑完，这里只是不再阻塞等待；清掉定时器防止它在事件循环里多挂 5 秒。
    ctx.setAppState(prev =>
      prev.computerUseMcpState?.hiddenDuringTurn === undefined
        ? prev
        : {
            ...prev,
            computerUseMcpState: {
              ...prev.computerUseMcpState,
              hiddenDuringTurn: undefined,
            },
          },
    )
  }
// 收尾后把隐藏集合置回 undefined：下一次回合据此判断「这轮没有需要恢复的应用」，不必再扫一遍列表。

  // Zero-syscall pre-check so non-CU turns don't touch disk. Release is still
  // idempotent (returns false if already released or owned by another session).
  if (!isLockHeldLocally()) return
// 零系统调用的预检查：非计算机操控的回合在这里立刻返回，连磁盘都不碰；真正的释放本身也是幂等的。

  // Unregister before lock release so the pump-retain drops as soon as the
  // CU session ends. Idempotent — no-ops if registration failed at acquire.
  // Swallow throws so a NAPI unregister error never prevents lock release —
  // a held lock blocks the next CU session with "in use by another session".
  try {
    unregisterEscHotkey()
  } catch (err) {
    logForDebugging(
      `[Computer Use MCP] unregisterEscHotkey failed: ${errorMessage(err)}`,
    )
  }
// 注销热键失败只记日志不抛：锁没释放会让下一次操控直接报「被其他会话占用」，比热键残留严重得多，所以必须保证走到释放那一步。

  if (await releaseComputerUseLock()) {
    ctx.sendOSNotification?.({
      message: 'Claude is done using your computer',
      notificationType: 'computer_use_exit',
    })
  }
}
// 只有真正释放成功才发系统通知：避免在锁本就不属于本会话时误报「Claude 用完了你的电脑」。
