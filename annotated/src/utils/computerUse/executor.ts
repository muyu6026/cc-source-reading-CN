// 文件级：本文件是 computer-use（计算机操控）的 CLI 版执行器实现，封装两个原生模块 —— Rust/enigo 的输入模块（鼠标、键盘、前台 app）与 Swift 模块（截图、NSWorkspace、TCC）。
/**
 * CLI `ComputerExecutor` implementation. Wraps two native modules:
 *   - `@ant/computer-use-input` (Rust/enigo) — mouse, keyboard, frontmost app
 *   - `@ant/computer-use-swift` — SCContentFilter screenshots, NSWorkspace apps, TCC
 *
 * Contract: `packages/desktop/computer-use-mcp/src/executor.ts` in the apps
 * repo. The reference impl is Cowork's `apps/desktop/src/main/nest-only/
 * computer-use/executor.ts` — see notable deviations under "CLI deltas" below.
 *
 * ── CLI deltas from Cowork ─────────────────────────────────────────────────
 *
 * No `withClickThrough`. Cowork wraps every mouse op in
 *   `BrowserWindow.setIgnoreMouseEvents(true)` so clicks fall through the
 *   overlay. We're a terminal — no window — so the click-through bracket is
 *   a no-op. The sentinel `CLI_HOST_BUNDLE_ID` never matches frontmost.
 *
 * Terminal as surrogate host. `getTerminalBundleId()` detects the emulator
 *   we're running inside. It's passed as `hostBundleId` to `prepareDisplay`/
 *   `resolvePrepareCapture` so the Swift side exempts it from hide AND skips
 *   it in the activate z-order walk (so the terminal being frontmost doesn't
 *   eat clicks meant for the target app). Also stripped from `allowedBundleIds`
 *   via `withoutTerminal()` so screenshots don't capture it (Swift 0.2.1's
 *   captureExcluding takes an allow-list despite the name — apps#30355).
 *   `capabilities.hostBundleId` stays as the sentinel — the package's
 *   frontmost gate uses that, and the terminal being frontmost is fine.
 *
 * Clipboard via `pbcopy`/`pbpaste`. No Electron `clipboard` module.
 */
// 本执行器与 Cowork 参考实现有几处 CLI 专属差异：无点击穿透（终端无窗口所以为空操作）、终端作为「替代宿主」、剪贴板走 `pbcopy`/`pbpaste` 而非 Electron 剪贴板模块。

import type {
  ComputerExecutor,
  DisplayGeometry,
  FrontmostApp,
  InstalledApp,
  ResolvePrepareCaptureResult,
  RunningApp,
  ScreenshotResult,
} from '@ant/computer-use-mcp'

import { API_RESIZE_PARAMS, targetImageSize } from '@ant/computer-use-mcp'
// 从 `@ant/computer-use-mcp` 引入截图尺寸换算与 API 缩放参数。
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { sleep } from '../sleep.js'
import {
  CLI_CU_CAPABILITIES,
  CLI_HOST_BUNDLE_ID,
  getTerminalBundleId,
} from './common.js'
import { drainRunLoop } from './drainRunLoop.js'
import { notifyExpectedEscape } from './escHotkey.js'
import { requireComputerUseInput } from './inputLoader.js'
import { requireComputerUseSwift } from './swiftLoader.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCREENSHOT_JPEG_QUALITY = 0.75
// 截图 JPEG 质量固定为 0.75。

/** Logical → physical → API target dims. See `targetImageSize` + COORDINATES.md. */
// `computeTargetDims`：逻辑像素 → 物理像素 → API 目标尺寸，保证坐标换算一致。
function computeTargetDims(
  logicalW: number,
  logicalH: number,
  scaleFactor: number,
): [number, number] {
  const physW = Math.round(logicalW * scaleFactor)
  const physH = Math.round(logicalH * scaleFactor)
  return targetImageSize(physW, physH, API_RESIZE_PARAMS)
}

async function readClipboardViaPbpaste(): Promise<string> {
// `readClipboardViaPbpaste`：通过 `pbpaste` 读出剪贴板文本。
  const { stdout, code } = await execFileNoThrow('pbpaste', [], {
    useCwd: false,
  })
  if (code !== 0) {
    throw new Error(`pbpaste exited with code ${code}`)
  }
  return stdout
}

async function writeClipboardViaPbcopy(text: string): Promise<void> {
// `writeClipboardViaPbcopy`：通过 `pbcopy` 写入剪贴板（把文本作为标准输入喂给命令）。
  const { code } = await execFileNoThrow('pbcopy', [], {
    input: text,
    useCwd: false,
  })
  if (code !== 0) {
    throw new Error(`pbcopy exited with code ${code}`)
  }
}

type Input = ReturnType<typeof requireComputerUseInput>
// `Input` 类型：由 `requireComputerUseInput` 返回的 Rust/enigo 输入模块句柄。

/**
 * Single-element key sequence matching "escape" or "esc" (case-insensitive).
 * Used to hole-punch the CGEventTap abort for model-synthesized Escape — enigo
 * accepts both spellings, so the tap must too.
 */
// `isBareEscape`：判断单键序列是否就是 escape 或 esc（大小写不敏感），用于给 CGEventTap 打洞放行模型合成的 Esc。
function isBareEscape(parts: readonly string[]): boolean {
  if (parts.length !== 1) return false
  const lower = parts[0]!.toLowerCase()
  return lower === 'escape' || lower === 'esc'
}

/**
 * Instant move, then 50ms — an input→HID→AppKit→NSEvent round-trip before the
 * caller reads `NSEvent.mouseLocation` or dispatches a click. Used for click,
 * scroll, and drag-from; `animatedMove` is reserved for drag-to only. The
 * intermediate animation frames were triggering hover states and, on the
 * decomposed mouseDown/moveMouse path, emitting stray `.leftMouseDragged`
 * events (toolCalls.ts handleScroll's mouse_full workaround).
 */
// `MOVE_SETTLE_MS`：瞬时移动后等 50ms，让输入→HID→AppKit→NSEvent 走完一轮，再读鼠标位置或发点击。
const MOVE_SETTLE_MS = 50

async function moveAndSettle(
  input: Input,
  x: number,
  y: number,
): Promise<void> {
  await input.moveMouse(x, y, false)
  await sleep(MOVE_SETTLE_MS)
}

/**
 * Release `pressed` in reverse (last pressed = first released). Errors are
 * swallowed so a release failure never masks the real error.
 *
 * Drains via pop() rather than snapshotting length: if a drainRunLoop-
 * orphaned press lambda resolves an in-flight input.key() AFTER finally
 * calls us, that late push is still released on the next iteration. The
 * orphaned flag stops the lambda at its NEXT check, not the current await.
 */
// `releasePressed`：逆序释放按下的键（最后按的最先放），释放失败直接吞掉，避免掩盖真正的错误。
async function releasePressed(input: Input, pressed: string[]): Promise<void> {
  let k: string | undefined
  while ((k = pressed.pop()) !== undefined) {
    try {
      await input.key(k, 'release')
    } catch {
      // Swallow — best-effort release.
    }
  }
}

/**
 * Bracket `fn()` with modifier press/release. `pressed` tracks which presses
 * actually landed, so a mid-press throw only releases what was pressed — no
 * stuck modifiers. The finally covers both press-phase and fn() throws.
 *
 * Caller must already be inside drainRunLoop() — key() dispatches to the
 * main queue and needs the pump to resolve.
 */
// `withModifiers`：用修饰键按/放把 `fn` 包起来，`pressed` 只记录真正落地的按键，中途抛错也只放已按的，避免卡住的修饰键。
async function withModifiers<T>(
  input: Input,
  mods: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const pressed: string[] = []
  try {
    for (const m of mods) {
      await input.key(m, 'press')
      pressed.push(m)
    }
    return await fn()
  } finally {
    await releasePressed(input, pressed)
  }
}

/**
 * Port of Cowork's `typeViaClipboard`. Sequence:
 *   1. Save the user's clipboard.
 *   2. Write our text.
 *   3. READ-BACK VERIFY — clipboard writes can silently fail. If the
 *      read-back doesn't match, never press Cmd+V (would paste junk).
 *   4. Cmd+V via keys().
 *   5. Sleep 100ms — battle-tested threshold for the paste-effect vs
 *      clipboard-restore race. Restoring too soon means the target app
 *      pastes the RESTORED content.
 *   6. Restore — in a `finally`, so a throw between 2-5 never leaves the
 *      user's clipboard clobbered. Restore failures are swallowed.
 */
// `typeViaClipboard`：仿照 Cowork 的剪贴板打字法 —— 先存用户剪贴板，写入文本后「读回校验」，不一致绝不按 Cmd+V，最后在 finally 里恢复，避免污染用户剪贴板。
async function typeViaClipboard(input: Input, text: string): Promise<void> {
  let saved: string | undefined
  try {
    saved = await readClipboardViaPbpaste()
  } catch {
    logForDebugging(
      '[computer-use] pbpaste before paste failed; proceeding without restore',
    )
  }

  try {
    await writeClipboardViaPbcopy(text)
    if ((await readClipboardViaPbpaste()) !== text) {
      throw new Error('Clipboard write did not round-trip.')
    }
    await input.keys(['command', 'v'])
    await sleep(100)
  } finally {
    if (typeof saved === 'string') {
      try {
        await writeClipboardViaPbcopy(saved)
      } catch {
        logForDebugging('[computer-use] clipboard restore after paste failed')
      }
    }
  }
}

/**
 * Port of Cowork's `animateMouseMovement` + `animatedMove`. Ease-out-cubic at
 * 60fps; distance-proportional duration at 2000 px/sec, capped at 0.5s. When
 * the sub-gate is off (or distance < ~2 frames), falls through to
 * `moveAndSettle`. Called only from `drag` for the press→to motion — target
 * apps may watch for `.leftMouseDragged` specifically (not just "button down +
 * position changed") and the slow motion gives them time to process
 * intermediate positions (scrollbars, window resizes).
 */
// `animatedMove`：缓出三次方的鼠标动画，距离按比例限 2000px/秒、上限 0.5 秒；仅 drag 的「按下→移动」阶段使用。
async function animatedMove(
  input: Input,
  targetX: number,
  targetY: number,
  mouseAnimationEnabled: boolean,
): Promise<void> {
  if (!mouseAnimationEnabled) {
    await moveAndSettle(input, targetX, targetY)
    return
  }
  const start = await input.mouseLocation()
  const deltaX = targetX - start.x
  const deltaY = targetY - start.y
  const distance = Math.hypot(deltaX, deltaY)
  if (distance < 1) return
  const durationSec = Math.min(distance / 2000, 0.5)
  if (durationSec < 0.03) {
    await moveAndSettle(input, targetX, targetY)
    return
  }
  const frameRate = 60
  const frameIntervalMs = 1000 / frameRate
  const totalFrames = Math.floor(durationSec * frameRate)
  for (let frame = 1; frame <= totalFrames; frame++) {
    const t = frame / totalFrames
    const eased = 1 - Math.pow(1 - t, 3)
    await input.moveMouse(
      Math.round(start.x + deltaX * eased),
      Math.round(start.y + deltaY * eased),
      false,
    )
    if (frame < totalFrames) {
      await sleep(frameIntervalMs)
    }
  }
  // Last frame has no trailing sleep — same HID round-trip before the
  // caller's mouseButton reads NSEvent.mouseLocation.
  await sleep(MOVE_SETTLE_MS)
}

// ── Factory ───────────────────────────────────────────────────────────────

export function createCliExecutor(opts: {
// `createCliExecutor`：工厂函数，构造一个实现 `ComputerExecutor` 接口的执行器（仅 macOS 可用）。
  getMouseAnimationEnabled: () => boolean
  getHideBeforeActionEnabled: () => boolean
}): ComputerExecutor {
  if (process.platform !== 'darwin') {
// 非 macOS 直接抛错 —— 计算机操控目前只支持 macOS。
    throw new Error(
      `createCliExecutor called on ${process.platform}. Computer control is macOS-only.`,
    )
  }

  // Swift loaded once at factory time — every executor method needs it.
  // Input loaded lazily via requireComputerUseInput() on first mouse/keyboard
  // call — it caches internally, so screenshot-only flows never pull the
  // enigo .node.
  const cu = requireComputerUseSwift()
// Swift 模块在工厂构造时就加载一次（每个方法都要用）；Input 模块则在首次鼠标/键盘调用时才懒加载，纯截图流程不会拉起 enigo 的 node 模块。

  const { getMouseAnimationEnabled, getHideBeforeActionEnabled } = opts
  const terminalBundleId = getTerminalBundleId()
// 探测终端 bundleId 作为「替代宿主」，使其在隐藏、激活 z-order 走查、截图时都被豁免，终端前台不会抢走目标应用的点击。
  const surrogateHost = terminalBundleId ?? CLI_HOST_BUNDLE_ID
  // Swift 0.2.1's captureExcluding/captureRegion take an ALLOW list despite the
  // name (apps#30355 — complement computed Swift-side against running apps).
  // The terminal isn't in the user's grants so it's naturally excluded, but if
  // the package ever passes it through we strip it here so the terminal never
  // photobombs a screenshot.
  const withoutTerminal = (allowed: readonly string[]): string[] =>
// `withoutTerminal`：从允许列表里剥掉终端，避免截图把终端自己也拍进去（Swift 0.2.1 的 captureExcluding 实际是个允许名单）。
    terminalBundleId === null
      ? [...allowed]
      : allowed.filter(id => id !== terminalBundleId)

  logForDebugging(
    terminalBundleId
      ? `[computer-use] terminal ${terminalBundleId} → surrogate host (hide-exempt, activate-skip, screenshot-excluded)`
      : '[computer-use] terminal not detected; falling back to sentinel host',
  )

  return {
// `capabilities`：在 CLI 能力集基础上把 `hostBundleId` 固定为哨兵值（Swift 侧前台门用它判断）。
    capabilities: {
      ...CLI_CU_CAPABILITIES,
      hostBundleId: CLI_HOST_BUNDLE_ID,
    },

    // ── Pre-action sequence (hide + defocus) ────────────────────────────

    async prepareForAction(
// `prepareForAction`：动作前的「隐藏 + 失焦」序列；用 `drainRunLoop` 泵 CFRunLoop，避免窗口管理器事件堆积造成闪烁。
      allowlistBundleIds: string[],
      displayId?: number,
    ): Promise<string[]> {
      if (!getHideBeforeActionEnabled()) {
        return []
      }
      // prepareDisplay isn't @MainActor (plain Task{}), but its .hide() calls
      // trigger window-manager events that queue on CFRunLoop. Without the
      // pump, those pile up during Swift's ~1s of usleeps and flush all at
      // once when the next pumped call runs — visible window flashing.
      // Electron drains CFRunLoop continuously so Cowork doesn't see this.
      // Worst-case 100ms + 5×200ms safety-net ≈ 1.1s, well under the 30s
      // drainRunLoop ceiling.
      //
      // "Continue with action execution even if switching fails" — the
      // frontmost gate in toolCalls.ts catches any actual unsafe state.
      return drainRunLoop(async () => {
        try {
          const result = await cu.apps.prepareDisplay(
            allowlistBundleIds,
            surrogateHost,
            displayId,
          )
          if (result.activated) {
            logForDebugging(
              `[computer-use] prepareForAction: activated ${result.activated}`,
            )
          }
          return result.hidden
        } catch (err) {
          logForDebugging(
            `[computer-use] prepareForAction failed; continuing to action: ${errorMessage(err)}`,
            { level: 'warn' },
          )
          return []
        }
      })
    },

    async previewHideSet(
// `previewHideSet`：预览将被隐藏的 app 集合（含替代宿主）。
      allowlistBundleIds: string[],
      displayId?: number,
    ): Promise<Array<{ bundleId: string; displayName: string }>> {
      return cu.apps.previewHideSet(
        [...allowlistBundleIds, surrogateHost],
        displayId,
      )
    },

    // ── Display ──────────────────────────────────────────────────────────

    async getDisplaySize(displayId?: number): Promise<DisplayGeometry> {
// 显示相关：取屏幕尺寸、列出所有显示器、按 bundleId 找窗口所在显示器。
      return cu.display.getSize(displayId)
    },

    async listDisplays(): Promise<DisplayGeometry[]> {
      return cu.display.listAll()
    },

    async findWindowDisplays(
      bundleIds: string[],
    ): Promise<Array<{ bundleId: string; displayIds: number[] }>> {
      return cu.apps.findWindowDisplays(bundleIds)
    },

    async resolvePrepareCapture(opts: {
// `resolvePrepareCapture`：截图前解析参数，先按显示尺寸算目标分辨率，再包在 `drainRunLoop` 里调用 Swift。
      allowedBundleIds: string[]
      preferredDisplayId?: number
      autoResolve: boolean
      doHide?: boolean
    }): Promise<ResolvePrepareCaptureResult> {
      const d = cu.display.getSize(opts.preferredDisplayId)
      const [targetW, targetH] = computeTargetDims(
        d.width,
        d.height,
        d.scaleFactor,
      )
      return drainRunLoop(() =>
        cu.resolvePrepareCapture(
          withoutTerminal(opts.allowedBundleIds),
          surrogateHost,
          SCREENSHOT_JPEG_QUALITY,
          targetW,
          targetH,
          opts.preferredDisplayId,
          opts.autoResolve,
          opts.doHide,
        ),
      )
    },

    /**
     * Pre-size to `targetImageSize` output so the API transcoder's early-return
     * fires — no server-side resize, `scaleCoord` stays coherent. See
     * packages/desktop/computer-use-mcp/COORDINATES.md.
     */
    async screenshot(opts: {
// `screenshot`：截全屏，预缩放到目标尺寸，使 API 转码器走提前返回、不在服务端二次缩放。
      allowedBundleIds: string[]
      displayId?: number
    }): Promise<ScreenshotResult> {
      const d = cu.display.getSize(opts.displayId)
      const [targetW, targetH] = computeTargetDims(
        d.width,
        d.height,
        d.scaleFactor,
      )
      return drainRunLoop(() =>
        cu.screenshot.captureExcluding(
          withoutTerminal(opts.allowedBundleIds),
          SCREENSHOT_JPEG_QUALITY,
          targetW,
          targetH,
          opts.displayId,
        ),
      )
    },

    async zoom(
// `zoom`：对指定矩形区域截图放大（captureRegion）。
      regionLogical: { x: number; y: number; w: number; h: number },
      allowedBundleIds: string[],
      displayId?: number,
    ): Promise<{ base64: string; width: number; height: number }> {
      const d = cu.display.getSize(displayId)
      const [outW, outH] = computeTargetDims(
        regionLogical.w,
        regionLogical.h,
        d.scaleFactor,
      )
      return drainRunLoop(() =>
        cu.screenshot.captureRegion(
          withoutTerminal(allowedBundleIds),
          regionLogical.x,
          regionLogical.y,
          regionLogical.w,
          regionLogical.h,
          outW,
          outH,
          SCREENSHOT_JPEG_QUALITY,
          displayId,
        ),
      )
    },

    // ── Keyboard ─────────────────────────────────────────────────────────

    /**
     * xdotool-style sequence e.g. "ctrl+shift+a" → split on '+' and pass to
     * keys(). keys() dispatches to DispatchQueue.main — drainRunLoop pumps
     * CFRunLoop so it resolves. Rust's error-path cleanup (enigo_wrap.rs)
     * releases modifiers on each invocation, so a mid-loop throw leaves
     * nothing stuck. 8ms between iterations — 125Hz USB polling cadence.
     */
// `key`：xdotool 风格的组合键，按加号拆分后逐个派发；`key()` 走主队列需 `drainRunLoop` 泵；每键间隔 8ms（125Hz USB 轮询）。
    async key(keySequence: string, repeat?: number): Promise<void> {
      const input = requireComputerUseInput()
      const parts = keySequence.split('+').filter(p => p.length > 0)
      // Bare-only: the CGEventTap checks event.flags.isEmpty so ctrl+escape
      // etc. pass through without aborting.
      const isEsc = isBareEscape(parts)
      const n = repeat ?? 1
      await drainRunLoop(async () => {
        for (let i = 0; i < n; i++) {
          if (i > 0) {
            await sleep(8)
          }
          if (isEsc) {
            notifyExpectedEscape()
          }
          await input.keys(parts)
        }
      })
    },

    async holdKey(keyNames: string[], durationMs: number): Promise<void> {
// `holdKey`：按住若干键持续一段时间；`pressed` 跟踪真正按下的键，`orphaned` 标志防止超时后残留按键卡死。
      const input = requireComputerUseInput()
      // Press/release each wrapped in drainRunLoop; the sleep sits outside so
      // durationMs isn't bounded by drainRunLoop's 30s timeout. `pressed`
      // tracks which presses landed so a mid-press throw still releases
      // everything that was actually pressed.
      //
      // `orphaned` guards against a timeout-orphan race: if the press-phase
      // drainRunLoop times out while the esc-hotkey pump-retain keeps the
      // pump running, the orphaned lambda would continue pushing to `pressed`
      // after finally's releasePressed snapshotted the length — leaving keys
      // stuck. The flag stops the lambda at the next iteration.
      const pressed: string[] = []
      let orphaned = false
      try {
        await drainRunLoop(async () => {
          for (const k of keyNames) {
            if (orphaned) return
            // Bare Escape: notify the CGEventTap so it doesn't fire the
            // abort callback for a model-synthesized press. Same as key().
            if (isBareEscape([k])) {
              notifyExpectedEscape()
            }
            await input.key(k, 'press')
            pressed.push(k)
          }
        })
        await sleep(durationMs)
      } finally {
        orphaned = true
        await drainRunLoop(() => releasePressed(input, pressed))
      }
    },

    async type(text: string, opts: { viaClipboard: boolean }): Promise<void> {
// `type`：打字入口，`viaClipboard` 走剪贴板方案，否则逐字 `typeText`（grapheme 循环与 8ms 间隔在调用方处理）。
      const input = requireComputerUseInput()
      if (opts.viaClipboard) {
        // keys(['command','v']) inside needs the pump.
        await drainRunLoop(() => typeViaClipboard(input, text))
        return
      }
      // `toolCalls.ts` handles the grapheme loop + 8ms sleeps and calls this
      // once per grapheme. typeText doesn't dispatch to the main queue.
      await input.typeText(text)
    },

    readClipboard: readClipboardViaPbpaste,

    writeClipboard: writeClipboardViaPbcopy,

    // ── Mouse ────────────────────────────────────────────────────────────

    async moveMouse(x: number, y: number): Promise<void> {
// 鼠标：moveMouse / click / mouseDown / mouseUp / getCursorPosition；click 用 `withModifiers` 包修饰键，drag 保证按键无论如何都会释放。
      await moveAndSettle(requireComputerUseInput(), x, y)
    },

    /**
     * Move, then click. Modifiers are press/release bracketed via withModifiers
     * — same pattern as Cowork. AppKit computes NSEvent.clickCount from timing
     * + position proximity, so double/triple click work without setting the
     * CGEvent clickState field. key() inside withModifiers needs the pump;
     * the modifier-less path doesn't.
     */
    async click(
      x: number,
      y: number,
      button: 'left' | 'right' | 'middle',
      count: 1 | 2 | 3,
      modifiers?: string[],
    ): Promise<void> {
      const input = requireComputerUseInput()
      await moveAndSettle(input, x, y)
      if (modifiers && modifiers.length > 0) {
        await drainRunLoop(() =>
          withModifiers(input, modifiers, () =>
            input.mouseButton(button, 'click', count),
          ),
        )
      } else {
        await input.mouseButton(button, 'click', count)
      }
    },

    async mouseDown(): Promise<void> {
      await requireComputerUseInput().mouseButton('left', 'press')
    },

    async mouseUp(): Promise<void> {
      await requireComputerUseInput().mouseButton('left', 'release')
    },

    async getCursorPosition(): Promise<{ x: number; y: number }> {
      return requireComputerUseInput().mouseLocation()
    },

    /**
     * `from === undefined` → drag from current cursor (training's
     * left_click_drag with start_coordinate omitted). Inner `finally`: the
     * button is ALWAYS released even if the move throws — otherwise the
     * user's left button is stuck-pressed until they physically click.
     * 50ms sleep after press: enigo's move_mouse reads NSEvent.pressedMouseButtons
     * to decide .leftMouseDragged vs .mouseMoved; the synthetic leftMouseDown
     * needs a HID-tap round-trip to show up there.
     */
// `drag`：从光标或指定点拖到目标；内部 finally 永远释放左键，否则用户左键会卡住直到手动点击。
    async drag(
      from: { x: number; y: number } | undefined,
      to: { x: number; y: number },
    ): Promise<void> {
      const input = requireComputerUseInput()
      if (from !== undefined) {
        await moveAndSettle(input, from.x, from.y)
      }
      await input.mouseButton('left', 'press')
      await sleep(MOVE_SETTLE_MS)
      try {
        await animatedMove(input, to.x, to.y, getMouseAnimationEnabled())
      } finally {
        await input.mouseButton('left', 'release')
      }
    },

    /**
     * Move first, then scroll each axis. Vertical-first — it's the common
     * axis; a horizontal failure shouldn't lose the vertical.
     */
    async scroll(x: number, y: number, dx: number, dy: number): Promise<void> {
// `scroll`：先移后滚，纵向优先（常见轴），横向失败也不丢纵向。
      const input = requireComputerUseInput()
      await moveAndSettle(input, x, y)
      if (dy !== 0) {
        await input.mouseScroll(dy, 'vertical')
      }
      if (dx !== 0) {
        await input.mouseScroll(dx, 'horizontal')
      }
    },

    // ── App management ───────────────────────────────────────────────────
// 应用管理：取前台 app、点下应用、列已装/运行中 app、取图标、列运行中、按 bundleId 打开 app。

    async getFrontmostApp(): Promise<FrontmostApp | null> {
      const info = requireComputerUseInput().getFrontmostAppInfo()
      if (!info || !info.bundleId) return null
      return { bundleId: info.bundleId, displayName: info.appName }
    },

    async appUnderPoint(
      x: number,
      y: number,
    ): Promise<{ bundleId: string; displayName: string } | null> {
      return cu.apps.appUnderPoint(x, y)
    },

    async listInstalledApps(): Promise<InstalledApp[]> {
      // `ComputerUseInstalledApp` is `{bundleId, displayName, path}`.
      // `InstalledApp` adds optional `iconDataUrl` — left unpopulated;
      // the approval dialog fetches lazily via getAppIcon() below.
      return drainRunLoop(() => cu.apps.listInstalled())
    },

    async getAppIcon(path: string): Promise<string | undefined> {
      return cu.apps.iconDataUrl(path) ?? undefined
    },

    async listRunningApps(): Promise<RunningApp[]> {
      return cu.apps.listRunning()
    },

    async openApp(bundleId: string): Promise<void> {
// `openApp`：按 bundleId 打开应用。
      await cu.apps.open(bundleId)
    },
  }
}

/**
 * Module-level export (not on the executor object) — called at turn-end from
 * `stopHooks.ts` / `query.ts`, outside the executor lifecycle. Fire-and-forget
 * at the call site; the caller `.catch()`es.
 */
export async function unhideComputerUseApps(
// `unhideComputerUseApps`：模块级导出（不在执行器对象上），在回合结束时由 stopHooks / query 调用来恢复被隐藏的 app。
  bundleIds: readonly string[],
): Promise<void> {
  if (bundleIds.length === 0) return
  const cu = requireComputerUseSwift()
  await cu.apps.unhide([...bundleIds])
}
