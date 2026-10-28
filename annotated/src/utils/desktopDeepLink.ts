import { readdir } from 'fs/promises'
import { join } from 'path'
import { coerce as semverCoerce } from 'semver'
import { getSessionId } from '../bootstrap/state.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { pathExists } from './file.js'
import { gte as semverGte } from './semver.js'

const MIN_DESKTOP_VERSION = '1.1.2396'
// 桌面端最低兼容版本，低于此版本无法承接会话接力

// 判断是否开发模式：除 NODE_ENV 外，还要看可执行路径是否落在各 build 目录里
function isDevMode(): boolean {
  if ((process.env.NODE_ENV as string) === 'development') {
    return true
  }

  // Local builds from build directories are dev mode even with NODE_ENV=production
  const pathsToCheck = [process.argv[1] || '', process.execPath || '']
  const buildDirs = [
    '/build-ant/',
    '/build-ant-native/',
    '/build-external/',
    '/build-external-native/',
  ]

  return pathsToCheck.some(p => buildDirs.some(dir => p.includes(dir)))
}

/**
 * Builds a deep link URL for Claude Desktop to resume a CLI session.
 * Format: claude://resume?session={sessionId}&cwd={cwd}
 * In dev mode: claude-dev://resume?session={sessionId}&cwd={cwd}
 */
// 拼出接力深链：claude://resume?session=&cwd=，开发模式改用 claude-dev 协议
function buildDesktopDeepLink(sessionId: string): string {
  const protocol = isDevMode() ? 'claude-dev' : 'claude'
  const url = new URL(`${protocol}://resume`)
  url.searchParams.set('session', sessionId)
  url.searchParams.set('cwd', getCwd())
  return url.toString()
}

/**
 * Check if Claude Desktop app is installed.
 * On macOS, checks for /Applications/Claude.app.
 * On Linux, checks if xdg-open can handle claude:// protocol.
 * On Windows, checks if the protocol handler exists.
 * In dev mode, always returns true (assumes dev Desktop is running).
 */
// 判断桌面端是否安装：macOS 查 Claude.app、Linux 查 xdg 处理器、Windows 查注册表协议项；开发模式直接当已装
async function isDesktopInstalled(): Promise<boolean> {
  // In dev mode, assume the dev Desktop app is running
  if (isDevMode()) {
    return true
  }

  const platform = process.platform

  if (platform === 'darwin') {
    // Check for Claude.app in /Applications
    return pathExists('/Applications/Claude.app')
  } else if (platform === 'linux') {
    // Check if xdg-mime can find a handler for claude://
    // Note: xdg-mime returns exit code 0 even with no handler, so check stdout too
    const { code, stdout } = await execFileNoThrow('xdg-mime', [
      'query',
      'default',
      'x-scheme-handler/claude',
    ])
    return code === 0 && stdout.trim().length > 0
  } else if (platform === 'win32') {
    // On Windows, try to query the registry for the protocol handler
    const { code } = await execFileNoThrow('reg', [
      'query',
      'HKEY_CLASSES_ROOT\\claude',
      '/ve',
// Windows 下查询注册表中 claude 协议项是否存在来判断安装
    ])
    return code === 0
  }

  return false
}

/**
 * Detect the installed Claude Desktop version.
 * On macOS, reads CFBundleShortVersionString from the app plist.
 * On Windows, finds the highest app-X.Y.Z directory in the Squirrel install.
 * Returns null if version cannot be determined.
 */
// 读取已装桌面端版本：macOS 读 plist、Windows 在 Squirrel 安装目录里挑最高的 app-X.Y.Z
async function getDesktopVersion(): Promise<string | null> {
  const platform = process.platform

  if (platform === 'darwin') {
    const { code, stdout } = await execFileNoThrow('defaults', [
      'read',
      '/Applications/Claude.app/Contents/Info.plist',
      'CFBundleShortVersionString',
    ])
    if (code !== 0) {
      return null
    }
    const version = stdout.trim()
    return version.length > 0 ? version : null
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (!localAppData) {
      return null
    }
    const installDir = join(localAppData, 'AnthropicClaude')
    try {
      const entries = await readdir(installDir)
      const versions = entries
        .filter(e => e.startsWith('app-'))
        .map(e => e.slice(4))
        .filter(v => semverCoerce(v) !== null)
        .sort((a, b) => {
          const ca = semverCoerce(a)!
          const cb = semverCoerce(b)!
          return ca.compare(cb)
        })
      return versions.length > 0 ? versions[versions.length - 1]! : null
    } catch {
      return null
    }
  }

  return null
}

// 桌面端安装状态三态：未安装 / 版本过旧 / 就绪
export type DesktopInstallStatus =
  | { status: 'not-installed' }
  | { status: 'version-too-old'; version: string }
  | { status: 'ready'; version: string }

/**
 * Check Desktop install status including version compatibility.
 */
// 综合判断是否安装并校验版本兼容性，版本探不到时按就绪放行
export async function getDesktopInstallStatus(): Promise<DesktopInstallStatus> {
  const installed = await isDesktopInstalled()
  if (!installed) {
    return { status: 'not-installed' }
  }

  let version: string | null
  try {
    version = await getDesktopVersion()
  } catch {
    // Best effort — proceed with handoff if version detection fails
    return { status: 'ready', version: 'unknown' }
  }

  if (!version) {
    // Can't determine version — assume it's ready (dev mode or unknown install)
    return { status: 'ready', version: 'unknown' }
  }

  const coerced = semverCoerce(version)
  if (!coerced || !semverGte(coerced.version, MIN_DESKTOP_VERSION)) {
    return { status: 'version-too-old', version }
  }

  return { status: 'ready', version }
// 通过版本校验即就绪；探不到版本时前面已提前按就绪放行
}

/**
 * Opens a deep link URL using the platform-specific mechanism.
 * Returns true if the command succeeded, false otherwise.
 */
// 按平台机制打开深链：macOS 用 open、Linux 用 xdg-open、Windows 用 cmd start，开发模式用 AppleScript 路由到运行中的 Electron
async function openDeepLink(deepLinkUrl: string): Promise<boolean> {
  const platform = process.platform
  logForDebugging(`Opening deep link: ${deepLinkUrl}`)

  if (platform === 'darwin') {
    if (isDevMode()) {
      // In dev mode, `open` launches a bare Electron binary (without app code)
      // because setAsDefaultProtocolClient registers just the Electron executable.
      // Use AppleScript to route the URL to the already-running Electron app.
      const { code } = await execFileNoThrow('osascript', [
        '-e',
        `tell application "Electron" to open location "${deepLinkUrl}"`,
      ])
      return code === 0
    }
    const { code } = await execFileNoThrow('open', [deepLinkUrl])
    return code === 0
  } else if (platform === 'linux') {
    const { code } = await execFileNoThrow('xdg-open', [deepLinkUrl])
    return code === 0
  } else if (platform === 'win32') {
    // On Windows, use cmd /c start to open URLs
    const { code } = await execFileNoThrow('cmd', [
      '/c',
      'start',
      '',
      deepLinkUrl,
    ])
    return code === 0
  }

  return false
}

/**
 * Build and open a deep link to resume the current session in Claude Desktop.
 * Returns an object with success status and any error message.
 */
// 对外入口：确认桌面端已装后拼深链并打开，返回成功与否与深链地址
export async function openCurrentSessionInDesktop(): Promise<{
  success: boolean
  error?: string
  deepLinkUrl?: string
}> {
  const sessionId = getSessionId()

  // Check if Desktop is installed
  const installed = await isDesktopInstalled()
  if (!installed) {
    return {
      success: false,
      error:
        'Claude Desktop is not installed. Install it from https://claude.ai/download',
    }
  }

  // Build and open the deep link
  const deepLinkUrl = buildDesktopDeepLink(sessionId)
  const opened = await openDeepLink(deepLinkUrl)

  if (!opened) {
    return {
      success: false,
      error: 'Failed to open Claude Desktop. Please try opening it manually.',
      deepLinkUrl,
    }
  }

  return { success: true, deepLinkUrl }
}
