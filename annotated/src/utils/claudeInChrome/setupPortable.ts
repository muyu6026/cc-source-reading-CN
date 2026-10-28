import { readdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { isFsInaccessible } from '../errors.js'

export const CHROME_EXTENSION_URL = 'https://claude.ai/chrome'
// 浏览器扩展在 Claude 官网的落地页地址，供 TUI 或 VS Code 侧做「已安装」跳转或展示用。

// Production extension ID
const PROD_EXTENSION_ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn'
// Dev extension IDs (for internal use)
const DEV_EXTENSION_ID = 'dihbgbndebgnbjfmelmegjepbnkhlgni'
const ANT_EXTENSION_ID = 'dngcpimnedloihjnnfngkgjoidhnaolf'
// 三个扩展 ID：生产版加两个内部开发版（DEV 与 ANT），由环境变量 USER_TYPE 决定启用哪一组。

function getExtensionIds(): string[] {
  return process.env.USER_TYPE === 'ant'
    ? [PROD_EXTENSION_ID, DEV_EXTENSION_ID, ANT_EXTENSION_ID]
    : [PROD_EXTENSION_ID]
}
// 按运行环境返回要探测的扩展 ID 列表：ant 内部环境额外带上 DEV 与 ANT 开发版，否则只探生产版。

// Must match ChromiumBrowser from common.ts
export type ChromiumBrowser =
  | 'chrome'
  | 'brave'
  | 'arc'
  | 'chromium'
  | 'edge'
  | 'vivaldi'
  | 'opera'

export type BrowserPath = {
  browser: ChromiumBrowser
  path: string
}
// BrowserPath 描述「某浏览器加其用户数据目录绝对路径」，是探测函数的返回单元。

type Logger = (message: string) => void

// Browser detection order - must match BROWSER_DETECTION_ORDER from common.ts
const BROWSER_DETECTION_ORDER: ChromiumBrowser[] = [
  'chrome',
  'brave',
  'arc',
  'edge',
  'chromium',
  'vivaldi',
  'opera',
]
// 浏览器探测顺序，必须与 common.ts 里的 BROWSER_DETECTION_ORDER 保持一致，否则 TUI 与扩展结果会不一致。

type BrowserDataConfig = {
  macos: string[]
  linux: string[]
  windows: { path: string[]; useRoaming?: boolean }
}
// BrowserDataConfig 把每种浏览器的数据目录按操作系统分开描述：macOS 与 Linux 是路径段数组，Windows 用 AppData 拼接且可选 Roaming。

// Must match CHROMIUM_BROWSERS dataPath from common.ts
const CHROMIUM_BROWSERS: Record<ChromiumBrowser, BrowserDataConfig> = {
  chrome: {
    macos: ['Library', 'Application Support', 'Google', 'Chrome'],
    linux: ['.config', 'google-chrome'],
    windows: { path: ['Google', 'Chrome', 'User Data'] },
  },
  brave: {
    macos: ['Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'],
    linux: ['.config', 'BraveSoftware', 'Brave-Browser'],
    windows: { path: ['BraveSoftware', 'Brave-Browser', 'User Data'] },
  },
  arc: {
    macos: ['Library', 'Application Support', 'Arc', 'User Data'],
    linux: [],
    windows: { path: ['Arc', 'User Data'] },
  },
  chromium: {
    macos: ['Library', 'Application Support', 'Chromium'],
    linux: ['.config', 'chromium'],
    windows: { path: ['Chromium', 'User Data'] },
  },
  edge: {
    macos: ['Library', 'Application Support', 'Microsoft Edge'],
    linux: ['.config', 'microsoft-edge'],
    windows: { path: ['Microsoft', 'Edge', 'User Data'] },
  },
  vivaldi: {
    macos: ['Library', 'Application Support', 'Vivaldi'],
    linux: ['.config', 'vivaldi'],
    windows: { path: ['Vivaldi', 'User Data'] },
  },
  opera: {
    macos: ['Library', 'Application Support', 'com.operasoftware.Opera'],
    linux: ['.config', 'opera'],
    windows: { path: ['Opera Software', 'Opera Stable'], useRoaming: true },
  },
}
// CHROMIUM_BROWSERS 汇总七大 Chromium 系浏览器的数据目录布局；这是便携版直接依赖的查表，避免读 common.ts 的运行时依赖。

/**
 * Get all browser data paths to check for extension installation.
 * Portable version that uses process.platform directly.
 */
// 便携版入口：枚举所有受支持浏览器，按 process.platform 直接拼出用户数据目录绝对路径，不依赖 common.ts 的运行时初始化。
export function getAllBrowserDataPathsPortable(): BrowserPath[] {
  const home = homedir()
  const paths: BrowserPath[] = []

  for (const browserId of BROWSER_DETECTION_ORDER) {
    const config = CHROMIUM_BROWSERS[browserId]
    let dataPath: string[] | undefined

    switch (process.platform) {
      case 'darwin':
        dataPath = config.macos
        break
      case 'linux':
        dataPath = config.linux
        break
      case 'win32': {
        if (config.windows.path.length > 0) {
          const appDataBase = config.windows.useRoaming
            ? join(home, 'AppData', 'Roaming')
            : join(home, 'AppData', 'Local')
          paths.push({
            browser: browserId,
            path: join(appDataBase, ...config.windows.path),
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
// 返回收集到的全部浏览器数据路径；macOS 与 Linux 用 home 拼接，Windows 走 AppData 基址（Roaming 或 Local）。

/**
 * Detects if the Claude in Chrome extension is installed by checking the Extensions
 * directory across all supported Chromium-based browsers and their profiles.
 *
 * This is a portable version that can be used by both TUI and VS Code extension.
 *
 * @param browserPaths - Array of browser data paths to check (from getAllBrowserDataPaths)
 * @param log - Optional logging callback for debug messages
 * @returns Object with isInstalled boolean and the browser where the extension was found
 */
// 探测扩展是否安装：遍历各浏览器数据目录下的 Default 与 Profile N 文件夹，看是否存在目标扩展 ID 的子目录。
export async function detectExtensionInstallationPortable(
  browserPaths: BrowserPath[],
  log?: Logger,
): Promise<{
  isInstalled: boolean
  browser: ChromiumBrowser | null
}> {
  if (browserPaths.length === 0) {
    log?.(`[Claude in Chrome] No browser paths to check`)
    return { isInstalled: false, browser: null }
  }

  const extensionIds = getExtensionIds()

  // Check each browser for the extension
  for (const { browser, path: browserBasePath } of browserPaths) {
    let browserProfileEntries = []

    try {
      browserProfileEntries = await readdir(browserBasePath, {
        withFileTypes: true,
      })
    } catch (e) {
      // Browser not installed or path doesn't exist, continue to next browser
      if (isFsInaccessible(e)) continue
      throw e
    }

    const profileDirs = browserProfileEntries
      .filter(entry => entry.isDirectory())
      .filter(
        entry => entry.name === 'Default' || entry.name.startsWith('Profile '),
      )
      .map(entry => entry.name)

    if (profileDirs.length > 0) {
      log?.(
        `[Claude in Chrome] Found ${browser} profiles: ${profileDirs.join(', ')}`,
      )
    }

    // Check each profile for any of the extension IDs
    for (const profile of profileDirs) {
      for (const extensionId of extensionIds) {
        const extensionPath = join(
          browserBasePath,
          profile,
          'Extensions',
          extensionId,
        )

        try {
          await readdir(extensionPath)
          log?.(
            `[Claude in Chrome] Extension ${extensionId} found in ${browser} ${profile}`,
          )
          return { isInstalled: true, browser }
        } catch {
          // Extension not found in this profile, continue checking
        }
      }
    }
  }

  log?.(`[Claude in Chrome] Extension not found in any browser`)
  return { isInstalled: false, browser: null }
}
// 未在任何浏览器或配置中命中扩展则返回未安装；单个目录读取失败（非权限问题）会跳过并继续下一个。

/**
 * Simple wrapper that returns just the boolean result
 */
export async function isChromeExtensionInstalledPortable(
  browserPaths: BrowserPath[],
  log?: Logger,
): Promise<boolean> {
  const result = await detectExtensionInstallationPortable(browserPaths, log)
  return result.isInstalled
}
// 只是把上面的探测结果收敛成一个布尔值，给只关心「装没装」的调用方用。

/**
 * Convenience function that gets browser paths automatically.
 * Use this when you don't need to provide custom browser paths.
 */
export function isChromeExtensionInstalled(log?: Logger): Promise<boolean> {
  const browserPaths = getAllBrowserDataPathsPortable()
  return isChromeExtensionInstalledPortable(browserPaths, log)
}
// 最省事的入口：内部先算好浏览器路径再调探测函数，适合不需要自定义路径的调用方。
