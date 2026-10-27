import { readdirSync } from 'fs'
// 本模块是 Claude in Chrome 的通用能力：定义受支持的 Chromium 系浏览器清单（Chrome、Brave、Arc、Edge、Vivaldi、Opera 等）及其各平台的数据路径、原生消息宿主路径与注册表键，并提供浏览器检测、标签页追踪与 Unix/Windows 套接字路径工具。
import { stat } from 'fs/promises'
import { homedir, platform, tmpdir, userInfo } from 'os'
import { join } from 'path'
import { normalizeNameForMCP } from '../../services/mcp/normalization.js'
import { logForDebugging } from '../debug.js'
import { isFsInaccessible } from '../errors.js'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { getPlatform } from '../platform.js'
import { which } from '../which.js'

export const CLAUDE_IN_CHROME_MCP_SERVER_NAME = 'claude-in-chrome'
// Claude in Chrome 的 MCP 服务器名称常量。

// Re-export ChromiumBrowser type for setup.ts
export type { ChromiumBrowser } from './setupPortable.js'
// 为 setup.ts 重新导出 ChromiumBrowser 类型。

// Import for local use
import type { ChromiumBrowser } from './setupPortable.js'

type BrowserConfig = {
  name: string
  macos: {
    appName: string
    dataPath: string[]
    nativeMessagingPath: string[]
  }
  linux: {
    binaries: string[]
    dataPath: string[]
    nativeMessagingPath: string[]
  }
  windows: {
    dataPath: string[]
    registryKey: string
    useRoaming?: boolean // Opera uses Roaming instead of Local
  }
}

export const CHROMIUM_BROWSERS: Record<ChromiumBrowser, BrowserConfig> = {
// 各浏览器的配置表：含 macOS 应用名与数据路径、Linux 二进制与路径、Windows 数据路径与注册表键；Opera 用 Roaming 而非 Local。
  chrome: {
    name: 'Google Chrome',
    macos: {
      appName: 'Google Chrome',
      dataPath: ['Library', 'Application Support', 'Google', 'Chrome'],
      nativeMessagingPath: [
        'Library',
        'Application Support',
        'Google',
        'Chrome',
        'NativeMessagingHosts',
      ],
    },
    linux: {
      binaries: ['google-chrome', 'google-chrome-stable'],
      dataPath: ['.config', 'google-chrome'],
      nativeMessagingPath: ['.config', 'google-chrome', 'NativeMessagingHosts'],
    },
    windows: {
      dataPath: ['Google', 'Chrome', 'User Data'],
      registryKey: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
    },
  },
  brave: {
    name: 'Brave',
    macos: {
      appName: 'Brave Browser',
      dataPath: [
        'Library',
        'Application Support',
        'BraveSoftware',
        'Brave-Browser',
      ],
      nativeMessagingPath: [
        'Library',
        'Application Support',
        'BraveSoftware',
        'Brave-Browser',
        'NativeMessagingHosts',
      ],
    },
    linux: {
      binaries: ['brave-browser', 'brave'],
      dataPath: ['.config', 'BraveSoftware', 'Brave-Browser'],
      nativeMessagingPath: [
        '.config',
        'BraveSoftware',
        'Brave-Browser',
        'NativeMessagingHosts',
      ],
    },
    windows: {
      dataPath: ['BraveSoftware', 'Brave-Browser', 'User Data'],
      registryKey:
        'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
    },
  },
  arc: {
    name: 'Arc',
    macos: {
      appName: 'Arc',
      dataPath: ['Library', 'Application Support', 'Arc', 'User Data'],
      nativeMessagingPath: [
        'Library',
        'Application Support',
        'Arc',
        'User Data',
        'NativeMessagingHosts',
      ],
    },
    linux: {
      // Arc is not available on Linux
      binaries: [],
      dataPath: [],
      nativeMessagingPath: [],
    },
    windows: {
      // Arc Windows is Chromium-based
      dataPath: ['Arc', 'User Data'],
      registryKey: 'HKCU\\Software\\ArcBrowser\\Arc\\NativeMessagingHosts',
    },
  },
  chromium: {
    name: 'Chromium',
    macos: {
      appName: 'Chromium',
      dataPath: ['Library', 'Application Support', 'Chromium'],
      nativeMessagingPath: [
        'Library',
        'Application Support',
        'Chromium',
        'NativeMessagingHosts',
      ],
    },
    linux: {
      binaries: ['chromium', 'chromium-browser'],
      dataPath: ['.config', 'chromium'],
      nativeMessagingPath: ['.config', 'chromium', 'NativeMessagingHosts'],
    },
    windows: {
      dataPath: ['Chromium', 'User Data'],
      registryKey: 'HKCU\\Software\\Chromium\\NativeMessagingHosts',
    },
  },
  edge: {
    name: 'Microsoft Edge',
    macos: {
      appName: 'Microsoft Edge',
      dataPath: ['Library', 'Application Support', 'Microsoft Edge'],
      nativeMessagingPath: [
        'Library',
        'Application Support',
        'Microsoft Edge',
        'NativeMessagingHosts',
      ],
    },
    linux: {
      binaries: ['microsoft-edge', 'microsoft-edge-stable'],
      dataPath: ['.config', 'microsoft-edge'],
      nativeMessagingPath: [
        '.config',
        'microsoft-edge',
        'NativeMessagingHosts',
      ],
    },
    windows: {
      dataPath: ['Microsoft', 'Edge', 'User Data'],
      registryKey: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
    },
  },
  vivaldi: {
    name: 'Vivaldi',
    macos: {
      appName: 'Vivaldi',
      dataPath: ['Library', 'Application Support', 'Vivaldi'],
      nativeMessagingPath: [
        'Library',
        'Application Support',
        'Vivaldi',
        'NativeMessagingHosts',
      ],
    },
    linux: {
      binaries: ['vivaldi', 'vivaldi-stable'],
      dataPath: ['.config', 'vivaldi'],
      nativeMessagingPath: ['.config', 'vivaldi', 'NativeMessagingHosts'],
    },
    windows: {
      dataPath: ['Vivaldi', 'User Data'],
      registryKey: 'HKCU\\Software\\Vivaldi\\NativeMessagingHosts',
    },
  },
  opera: {
    name: 'Opera',
    macos: {
      appName: 'Opera',
      dataPath: ['Library', 'Application Support', 'com.operasoftware.Opera'],
      nativeMessagingPath: [
        'Library',
        'Application Support',
        'com.operasoftware.Opera',
        'NativeMessagingHosts',
      ],
    },
    linux: {
      binaries: ['opera'],
      dataPath: ['.config', 'opera'],
      nativeMessagingPath: ['.config', 'opera', 'NativeMessagingHosts'],
    },
    windows: {
      dataPath: ['Opera Software', 'Opera Stable'],
      registryKey:
        'HKCU\\Software\\Opera Software\\Opera Stable\\NativeMessagingHosts',
      useRoaming: true, // Opera uses Roaming AppData, not Local
    },
  },
}
// 浏览器配置表的收尾闭合。

// Priority order for browser detection (most common first)
export const BROWSER_DETECTION_ORDER: ChromiumBrowser[] = [
// 浏览器检测优先级（最常见在前）。
  'chrome',
  'brave',
  'arc',
  'edge',
  'chromium',
  'vivaldi',
  'opera',
]

/**
 * Get all browser data paths to check for extension installation
 */
// 返回所有浏览器的数据目录路径，用于检查扩展是否已安装；按当前平台拼接 home 与对应数据路径。
export function getAllBrowserDataPaths(): {
  browser: ChromiumBrowser
  path: string
}[] {
  const platform = getPlatform()
  const home = homedir()
  const paths: { browser: ChromiumBrowser; path: string }[] = []

  for (const browserId of BROWSER_DETECTION_ORDER) {
    const config = CHROMIUM_BROWSERS[browserId]
    let dataPath: string[] | undefined

    switch (platform) {
      case 'macos':
        dataPath = config.macos.dataPath
        break
      case 'linux':
      case 'wsl':
        dataPath = config.linux.dataPath
        break
      case 'windows': {
        if (config.windows.dataPath.length > 0) {
          const appDataBase = config.windows.useRoaming
            ? join(home, 'AppData', 'Roaming')
            : join(home, 'AppData', 'Local')
          paths.push({
            browser: browserId,
            path: join(appDataBase, ...config.windows.dataPath),
          })
        }
        continue
      }
    }

    if (dataPath && dataPath.length > 0) {
      paths.push({
        browser: browserId,
        path: join(home, ...dataPath),
      })
    }
  }

  return paths
}
// 函数收尾：返回拼接好的浏览器数据目录路径列表。

/**
 * Get native messaging host directories for all supported browsers
 */
// 返回所有浏览器的原生消息宿主目录；Windows 走注册表，不在此返回文件路径。
export function getAllNativeMessagingHostsDirs(): {
  browser: ChromiumBrowser
  path: string
}[] {
  const platform = getPlatform()
  const home = homedir()
  const paths: { browser: ChromiumBrowser; path: string }[] = []

  for (const browserId of BROWSER_DETECTION_ORDER) {
    const config = CHROMIUM_BROWSERS[browserId]

    switch (platform) {
      case 'macos':
        if (config.macos.nativeMessagingPath.length > 0) {
          paths.push({
            browser: browserId,
            path: join(home, ...config.macos.nativeMessagingPath),
          })
        }
        break
      case 'linux':
      case 'wsl':
        if (config.linux.nativeMessagingPath.length > 0) {
          paths.push({
            browser: browserId,
            path: join(home, ...config.linux.nativeMessagingPath),
          })
        }
        break
      case 'windows':
        // Windows uses registry, not file paths for native messaging
        // We'll use a common location for the manifest file
        break
    }
  }

  return paths
}
// 函数收尾：返回原生消息宿主目录列表。

/**
 * Get Windows registry keys for all supported browsers
 */
// 返回所有浏览器在 Windows 注册表中对应的原生消息宿主键。
export function getAllWindowsRegistryKeys(): {
  browser: ChromiumBrowser
  key: string
}[] {
  const keys: { browser: ChromiumBrowser; key: string }[] = []

  for (const browserId of BROWSER_DETECTION_ORDER) {
    const config = CHROMIUM_BROWSERS[browserId]
    if (config.windows.registryKey) {
      keys.push({
        browser: browserId,
        key: config.windows.registryKey,
      })
    }
  }

  return keys
}
// 函数收尾：返回注册表键列表。

/**
 * Detect which browser to use for opening URLs
 * Returns the first available browser, or null if none found
 */
// 检测用于打开 URL 的可用浏览器：按优先级逐个检查应用包、可执行文件或数据目录是否存在，未找到返回 null。
export async function detectAvailableBrowser(): Promise<ChromiumBrowser | null> {
  const platform = getPlatform()

  for (const browserId of BROWSER_DETECTION_ORDER) {
    const config = CHROMIUM_BROWSERS[browserId]

    switch (platform) {
      case 'macos': {
        // Check if the .app bundle (a directory) exists
        const appPath = `/Applications/${config.macos.appName}.app`
        try {
          const stats = await stat(appPath)
          if (stats.isDirectory()) {
            logForDebugging(
              `[Claude in Chrome] Detected browser: ${config.name}`,
            )
            return browserId
          }
        } catch (e) {
          if (!isFsInaccessible(e)) throw e
          // App not found, continue checking
        }
        break
      }
      case 'wsl':
      case 'linux': {
        // Check if any binary exists
        for (const binary of config.linux.binaries) {
          if (await which(binary).catch(() => null)) {
            logForDebugging(
              `[Claude in Chrome] Detected browser: ${config.name}`,
            )
            return browserId
          }
        }
        break
      }
      case 'windows': {
        // Check if data path exists (indicates browser is installed)
        const home = homedir()
        if (config.windows.dataPath.length > 0) {
          const appDataBase = config.windows.useRoaming
            ? join(home, 'AppData', 'Roaming')
            : join(home, 'AppData', 'Local')
          const dataPath = join(appDataBase, ...config.windows.dataPath)
          try {
            const stats = await stat(dataPath)
            if (stats.isDirectory()) {
              logForDebugging(
                `[Claude in Chrome] Detected browser: ${config.name}`,
              )
              return browserId
            }
          } catch (e) {
            if (!isFsInaccessible(e)) throw e
            // Browser not found, continue checking
          }
        }
        break
      }
    }
  }

  return null
}
// 函数收尾：按平台与优先级返回第一个可用的浏览器。

export function isClaudeInChromeMCPServer(name: string): boolean {
// 判断某 MCP 服务器名是否为 claude-in-chrome（经 MCP 名称归一化比对）。
  return normalizeNameForMCP(name) === CLAUDE_IN_CHROME_MCP_SERVER_NAME
}

const MAX_TRACKED_TABS = 200
const trackedTabIds = new Set<number>()
// 最多追踪的标签页数量与已追踪标签页集合。

export function trackClaudeInChromeTabId(tabId: number): void {
// 记录某个标签页 ID 为已追踪；超过上限且为新标签时清空集合重新计数。
  if (trackedTabIds.size >= MAX_TRACKED_TABS && !trackedTabIds.has(tabId)) {
    trackedTabIds.clear()
  }
  trackedTabIds.add(tabId)
}

export function isTrackedClaudeInChromeTabId(tabId: number): boolean {
// 判断某标签页是否已被追踪。
  return trackedTabIds.has(tabId)
}

// 在检测到的浏览器中打开 URL：macOS 用 open -a，Windows 用 rundll32 规避命令行元字符问题，Linux/WSL 逐个尝试二进制。
export async function openInChrome(url: string): Promise<boolean> {
  const currentPlatform = getPlatform()

  // Detect the best available browser
  const browser = await detectAvailableBrowser()

  if (!browser) {
    logForDebugging('[Claude in Chrome] No compatible browser found')
    return false
  }

  const config = CHROMIUM_BROWSERS[browser]

  switch (currentPlatform) {
    case 'macos': {
      const { code } = await execFileNoThrow('open', [
        '-a',
        config.macos.appName,
        url,
      ])
      return code === 0
    }
    case 'windows': {
      // Use rundll32 to avoid cmd.exe metacharacter issues with URLs containing & | > <
      const { code } = await execFileNoThrow('rundll32', ['url,OpenURL', url])
      return code === 0
    }
    case 'wsl':
    case 'linux': {
      for (const binary of config.linux.binaries) {
        const { code } = await execFileNoThrow(binary, [url])
        if (code === 0) {
          return true
        }
      }
      return false
    }
    default:
      return false
  }
}
// 函数收尾：按平台返回打开是否成功。

/**
 * Get the socket directory path (Unix only)
 */
// 返回 Unix 下的套接字目录路径（含用户名）。
export function getSocketDir(): string {
  return `/tmp/claude-mcp-browser-bridge-${getUsername()}`
}

/**
 * Get the socket path (Unix) or pipe name (Windows)
 */
// 返回安全套接字路径：Windows 用命名管道，Unix 用目录下的 pid.sock。
export function getSecureSocketPath(): string {
  if (platform() === 'win32') {
    return `\\\\.\\pipe\\${getSocketName()}`
  }
  return join(getSocketDir(), `${process.pid}.sock`)
}
// 函数收尾：返回安全套接字路径。

/**
 * Get all socket paths including PID-based sockets in the directory
 * and legacy fallback paths
 */
// 返回全部套接字路径：含按 pid 的套接字与旧版回退路径；Windows 仅返回命名管道。
export function getAllSocketPaths(): string[] {
  // Windows uses named pipes, not Unix sockets
  if (platform() === 'win32') {
    return [`\\\\.\\pipe\\${getSocketName()}`]
  }

  const paths: string[] = []
  const socketDir = getSocketDir()

  // Scan for *.sock files in the socket directory
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- ClaudeForChromeContext.getSocketPaths (external @ant/claude-for-chrome-mcp) requires a sync () => string[] callback
    const files = readdirSync(socketDir)
    for (const file of files) {
      if (file.endsWith('.sock')) {
        paths.push(join(socketDir, file))
      }
    }
  } catch {
    // Directory may not exist yet
  }

  // Legacy fallback paths
  const legacyName = `claude-mcp-browser-bridge-${getUsername()}`
  const legacyTmpdir = join(tmpdir(), legacyName)
  const legacyTmp = `/tmp/${legacyName}`

  if (!paths.includes(legacyTmpdir)) {
    paths.push(legacyTmpdir)
  }
  if (legacyTmpdir !== legacyTmp && !paths.includes(legacyTmp)) {
    paths.push(legacyTmp)
  }

  return paths
}
// 函数收尾：返回合并后的套接字路径列表。

// 返回套接字名（须与 Chrome MCP 端保持一致）。
function getSocketName(): string {
  // NOTE: This must match the one used in the Claude in Chrome MCP
  return `claude-mcp-browser-bridge-${getUsername()}`
}
// 函数收尾：返回套接字名。

// 获取当前用户名，失败时回退到 USER/USERNAME 环境变量或 default。
function getUsername(): string {
  try {
    return userInfo().username || 'default'
  } catch {
    return process.env.USER || process.env.USERNAME || 'default'
  }
}
// 函数收尾：返回用户名。
