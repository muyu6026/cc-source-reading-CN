// 本文件集中存放 macOS 计算机使用（computer-use）能力的公共常量与辅助函数，供执行器与工具构建复用。
import { normalizeNameForMCP } from '../../services/mcp/normalization.js'
import { env } from '../env.js'

export const COMPUTER_USE_MCP_SERVER_NAME = 'computer-use'
// `COMPUTER_USE_MCP_SERVER_NAME` 是计算机使用 MCP 服务器的固定名称 `computer-use`，用于归一化后比较。

/**
 * Sentinel bundle ID for the frontmost gate. Claude Code is a terminal — it has
 * no window. This never matches a real `NSWorkspace.frontmostApplication`, so
 * the package's "host is frontmost" branch (mouse click-through exemption,
 * keyboard safety-net) is dead code for us. `prepareForAction`'s "exempt our
 * own window" is likewise a no-op — there is no window to exempt.
 */
export const CLI_HOST_BUNDLE_ID = 'com.anthropic.claude-code.cli-no-window'
// `CLI_HOST_BUNDLE_ID` 是给「最前窗口门控」用的哨兵 bundle ID：Claude Code 是终端进程没有窗口，永远不会匹配真实应用，因此包里的「宿主最前」豁免分支对我们是死代码。

/**
 * Fallback `env.terminal` → bundleId map for when `__CFBundleIdentifier` is
 * unset. Covers the macOS terminals we can distinguish — Linux entries
 * (konsole, gnome-terminal, xterm) are deliberately absent since
 * `createCliExecutor` is darwin-guarded.
 */
const TERMINAL_BUNDLE_ID_FALLBACK: Readonly<Record<string, string>> = {
// `TERMINAL_BUNDLE_ID_FALLBACK` 是 `env.terminal` 到 bundle ID 的回退映射表，覆盖能识别的 macOS 终端；Linux 项故意不列，因为创建执行器受 darwin 平台限制。
  'iTerm.app': 'com.googlecode.iterm2',
  Apple_Terminal: 'com.apple.Terminal',
  ghostty: 'com.mitchellh.ghostty',
  kitty: 'net.kovidgoyal.kitty',
  WarpTerminal: 'dev.warp.Warp-Stable',
  vscode: 'com.microsoft.VSCode',
}

/**
 * Bundle ID of the terminal emulator we're running inside, so `prepareDisplay`
 * can exempt it from hiding and `captureExcluding` can keep it out of
 * screenshots. Returns null when undetectable (ssh, cleared env, unknown
 * terminal) — caller must handle the null case.
 *
 * `__CFBundleIdentifier` is set by LaunchServices when a .app bundle spawns a
 * process and is inherited by children. It's the exact bundleId, no lookup
 * needed — handles terminals the fallback table doesn't know about. Under
 * tmux/screen it reflects the terminal that started the SERVER, which may
 * differ from the attached client. That's harmless here: we exempt A
 * terminal window, and the screenshots exclude it regardless.
 */
export function getTerminalBundleId(): string | null {
// `getTerminalBundleId` 返回当前所处终端模拟器的 bundle ID，用于豁免隐藏与截图排除；优先用 `__CFBundleIdentifier`，缺失时查回退表，都失败返回 `null`（调用方须处理 `null`）。
  const cfBundleId = process.env.__CFBundleIdentifier
  if (cfBundleId) return cfBundleId
  return TERMINAL_BUNDLE_ID_FALLBACK[env.terminal ?? ''] ?? null
}

/**
 * Static capabilities for macOS CLI. `hostBundleId` is not here — it's added
 * by `executor.ts` per `ComputerExecutor.capabilities`. `buildComputerUseTools`
 * takes this shape (no `hostBundleId`, no `teachMode`).
 */
export const CLI_CU_CAPABILITIES = {
// `CLI_CU_CAPABILITIES` 是 macOS CLI 的静态能力声明：原生截图过滤与 darwin 平台（`hostBundleId` 由执行器按实例补充）。
  screenshotFiltering: 'native' as const,
  platform: 'darwin' as const,
}

// `isComputerUseMCPServer` 判断某个 MCP 服务器名是否就是计算机使用服务器（归一化后比较名称）。
export function isComputerUseMCPServer(name: string): boolean {
  return normalizeNameForMCP(name) === COMPUTER_USE_MCP_SERVER_NAME
}
