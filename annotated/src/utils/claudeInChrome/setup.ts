// 文件级：本文件负责「Claude in Chrome」浏览器扩展的原生宿主安装与 MCP 配置——判断是否启用、生成调用本体的包装脚本、把原生消息宿主清单写进各浏览器目录（Windows 还需写注册表），并用磁盘缓存记录扩展是否已安装。
import { BROWSER_TOOLS } from '@ant/claude-for-chrome-mcp'
import { chmod, mkdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import {
  getIsInteractive,
  getIsNonInteractiveSession,
  getSessionBypassPermissionsMode,
} from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import { isInBundledMode } from '../bundledMode.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import {
  getClaudeConfigHomeDir,
  isEnvDefinedFalsy,
  isEnvTruthy,
} from '../envUtils.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { getPlatform } from '../platform.js'
import { jsonStringify } from '../slowOperations.js'
import {
  CLAUDE_IN_CHROME_MCP_SERVER_NAME,
  getAllBrowserDataPaths,
  getAllNativeMessagingHostsDirs,
  getAllWindowsRegistryKeys,
  openInChrome,
} from './common.js'
import { getChromeSystemPrompt } from './prompt.js'
import { isChromeExtensionInstalledPortable } from './setupPortable.js'

const CHROME_EXTENSION_RECONNECT_URL = 'https://clau.de/chrome/reconnect'
// `CHROME_EXTENSION_RECONNECT_URL`：首次安装后打开的重新连接页面地址。

const NATIVE_HOST_IDENTIFIER = 'com.anthropic.claude_code_browser_extension'
// `NATIVE_HOST_IDENTIFIER`：原生宿主标识，也是 Windows 注册表项与清单文件名的基名。
const NATIVE_HOST_MANIFEST_NAME = `${NATIVE_HOST_IDENTIFIER}.json`

// `shouldEnableClaudeInChrome`：综合 CLI 标志、环境变量与全局配置默认值，判断本次是否启用 Claude in Chrome；非交互会话默认关。
export function shouldEnableClaudeInChrome(chromeFlag?: boolean): boolean {
  // Disable by default in non-interactive sessions (e.g., SDK, CI)
  if (getIsNonInteractiveSession() && chromeFlag !== true) {
// 非交互会话（SDK/CI）且没显式打开就直接关闭。
    return false
  }

  // Check CLI flags
  if (chromeFlag === true) {
// CLI 标志优先：显式真/假直接决定。
    return true
  }
  if (chromeFlag === false) {
    return false
  }

  // Check environment variables
  if (isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_CFC)) {
// 环境变量 `CLAUDE_CODE_ENABLE_CFC` 真则开、假则关。
    return true
  }
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_ENABLE_CFC)) {
    return false
  }

  // Check default config settings
  const config = getGlobalConfig()
// 都没显式指定时看全局配置的 `claudeInChromeDefaultEnabled` 默认值。
  if (config.claudeInChromeDefaultEnabled !== undefined) {
    return config.claudeInChromeDefaultEnabled
  }

  return false
}

let shouldAutoEnable: boolean | undefined = undefined
// `shouldAutoEnable`：记忆化的自动启用判定，避免重复计算。

// `shouldAutoEnableClaudeInChrome`：仅交互会话、扩展已装、且（蚂蚁内部或灰度开关开）时才自动启用，结果记忆化。
export function shouldAutoEnableClaudeInChrome(): boolean {
  if (shouldAutoEnable !== undefined) {
    return shouldAutoEnable
  }

  shouldAutoEnable =
    getIsInteractive() &&
    isChromeExtensionInstalled_CACHED_MAY_BE_STALE() &&
    (process.env.USER_TYPE === 'ant' ||
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_chrome_auto_enable', false))

  return shouldAutoEnable
}

/**
 * Setup Claude in Chrome MCP server and tools
 *
 * @returns MCP config and allowed tools, or throws an error if platform is unsupported
 */
// `setupClaudeInChrome`：返回 Claude in Chrome 的 MCP 配置、允许的工具列表与系统提示词；不支持的平台会抛错。
export function setupClaudeInChrome(): {
  mcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
  systemPrompt: string
} {
  const isNativeBuild = isInBundledMode()
  const allowedTools = BROWSER_TOOLS.map(
// 把浏览工具映射成 `mcp__claude-in-chrome__工具名` 形式的允许工具。
    tool => `mcp__claude-in-chrome__${tool.name}`,
  )

  const env: Record<string, string> = {}
  if (getSessionBypassPermissionsMode()) {
// 若会话处于绕过权限模式，往宿主环境注入 `CLAUDE_CHROME_PERMISSION_MODE` 跳过权限检查。
    env.CLAUDE_CHROME_PERMISSION_MODE = 'skip_all_permission_checks'
  }
  const hasEnv = Object.keys(env).length > 0

  if (isNativeBuild) {
// 原生打包构建走一条配置：本体直接以 `--chrome-native-host` 当宿主命令。
    // Create a wrapper script that calls the same binary with --chrome-native-host. This
    // is needed because the native host manifest "path" field cannot contain arguments.
    const execCommand = `"${process.execPath}" --chrome-native-host`
// 宿主清单的 `path` 字段不能带参数，所以用包装脚本封装本体调用。

    // Run asynchronously without blocking; best-effort so swallow errors
    void createWrapperScript(execCommand)
      .then(manifestBinaryPath =>
        installChromeNativeHostManifest(manifestBinaryPath),
      )
      .catch(e =>
        logForDebugging(
          `[Claude in Chrome] Failed to install native host: ${e}`,
          { level: 'error' },
        ),
      )
// 异步安装原生宿主清单（尽力而为，失败只记日志不阻塞）。

    return {
      mcpConfig: {
        [CLAUDE_IN_CHROME_MCP_SERVER_NAME]: {
          type: 'stdio' as const,
          command: process.execPath,
          args: ['--claude-in-chrome-mcp'],
          scope: 'dynamic' as const,
          ...(hasEnv && { env }),
        },
      },
      allowedTools,
      systemPrompt: getChromeSystemPrompt(),
    }
// 原生构建分支的 MCP 配置用本体加 `--claude-in-chrome-mcp` 参数。
  } else {
    const __filename = fileURLToPath(import.meta.url)
// 非原生构建（开发态）用同目录的 `cli.js` 当宿主，其余逻辑一致。
    const __dirname = join(__filename, '..')
    const cliPath = join(__dirname, 'cli.js')

    void createWrapperScript(
      `"${process.execPath}" "${cliPath}" --chrome-native-host`,
    )
      .then(manifestBinaryPath =>
        installChromeNativeHostManifest(manifestBinaryPath),
      )
      .catch(e =>
        logForDebugging(
          `[Claude in Chrome] Failed to install native host: ${e}`,
          { level: 'error' },
        ),
      )

    const mcpConfig = {
      [CLAUDE_IN_CHROME_MCP_SERVER_NAME]: {
        type: 'stdio' as const,
        command: process.execPath,
        args: [`${cliPath}`, '--claude-in-chrome-mcp'],
        scope: 'dynamic' as const,
        ...(hasEnv && { env }),
      },
    }
// 开发态分支同样组装 MCP 配置，命令指向 `cli.js`。

    return {
      mcpConfig,
      allowedTools,
      systemPrompt: getChromeSystemPrompt(),
    }
  }
}

/**
 * Get native messaging hosts directories for all supported browsers
 * Returns an array of directories where the native host manifest should be installed
 */
// `getNativeMessagingHostsDirs`：取所有受支持浏览器的原生消息宿主目录；Windows 用单一固定位置，macOS/Linux 用各浏览器的目录列表。
function getNativeMessagingHostsDirs(): string[] {
  const platform = getPlatform()

  if (platform === 'windows') {
// Windows 把清单装到 `AppData/Claude Code/ChromeNativeHost`，路径由注册表项指向。
    // Windows uses a single location with registry entries pointing to it
    const home = homedir()
    const appData = process.env.APPDATA || join(home, 'AppData', 'Local')
    return [join(appData, 'Claude Code', 'ChromeNativeHost')]
  }

  // macOS and Linux: return all browser native messaging directories
  return getAllNativeMessagingHostsDirs().map(({ path }) => path)
}

// `installChromeNativeHostManifest`：把原生宿主清单写到各浏览器目录，内容一致就跳过写；Windows 还要写注册表并首次安装后打开重连页。
export async function installChromeNativeHostManifest(
  manifestBinaryPath: string,
): Promise<void> {
  const manifestDirs = getNativeMessagingHostsDirs()
  if (manifestDirs.length === 0) {
// 没有任何宿主目录说明平台不支持，抛错。
    throw Error('Claude in Chrome Native Host not supported on this platform')
  }

  const manifest = {
    name: NATIVE_HOST_IDENTIFIER,
    description: 'Claude Code Browser Extension Native Host',
    path: manifestBinaryPath,
    type: 'stdio',
    allowed_origins: [
      `chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/`, // PROD_EXTENSION_ID
      ...(process.env.USER_TYPE === 'ant'
        ? [
            'chrome-extension://dihbgbndebgnbjfmelmegjepbnkhlgni/', // DEV_EXTENSION_ID
            'chrome-extension://dngcpimnedloihjnnfngkgjoidhnaolf/', // ANT_EXTENSION_ID
          ]
        : []),
    ],
  }
// 组装清单对象：含标识、描述、宿主路径、stdio 类型与允许的扩展来源（生产 + 内部/开发 ID）。

  const manifestContent = jsonStringify(manifest, null, 2)
  let anyManifestUpdated = false

  // Install manifest to all browser directories
  for (const manifestDir of manifestDirs) {
    const manifestPath = join(manifestDir, NATIVE_HOST_MANIFEST_NAME)

    // Check if content matches to avoid unnecessary writes
    const existingContent = await readFile(manifestPath, 'utf-8').catch(
// 读取已存在的清单内容，完全相同就跳过写入，避免无谓写盘。
      () => null,
    )
    if (existingContent === manifestContent) {
      continue
    }

    try {
      await mkdir(manifestDir, { recursive: true })
      await writeFile(manifestPath, manifestContent)
// 目录确保存在后写入清单，记日志并标记有更新。
      logForDebugging(
        `[Claude in Chrome] Installed native host manifest at: ${manifestPath}`,
      )
      anyManifestUpdated = true
    } catch (error) {
      // Log but don't fail - the browser might not be installed
      logForDebugging(
        `[Claude in Chrome] Failed to install manifest at ${manifestPath}: ${error}`,
      )
    }
  }

  // Windows requires registry entries pointing to the manifest for each browser
  if (getPlatform() === 'windows') {
// Windows 上额外把清单路径写进注册表，让各浏览器能找到原生宿主。
    const manifestPath = join(manifestDirs[0]!, NATIVE_HOST_MANIFEST_NAME)
    registerWindowsNativeHosts(manifestPath)
  }

  // Restart the native host if we have rewritten any manifest
// 若重写了任何清单，首次安装检测触发后尝试打开重连页面（扩展已装才开）。
  if (anyManifestUpdated) {
    void isChromeExtensionInstalled().then(isInstalled => {
      if (isInstalled) {
        logForDebugging(
          `[Claude in Chrome] First-time install detected, opening reconnect page in browser`,
        )
        void openInChrome(CHROME_EXTENSION_RECONNECT_URL)
      } else {
        logForDebugging(
          `[Claude in Chrome] First-time install detected, but extension not installed, skipping reconnect`,
        )
      }
    })
  }
}

/**
 * Register the native host in Windows registry for all supported browsers
 */
// `registerWindowsNativeHosts`：用 `reg.exe` 把原生宿主注册到各浏览器的注册表项下，值为清单路径。
function registerWindowsNativeHosts(manifestPath: string): void {
  const registryKeys = getAllWindowsRegistryKeys()

  for (const { browser, key } of registryKeys) {
    const fullKey = `${key}\\${NATIVE_HOST_IDENTIFIER}`
// 拼接完整注册表键：基键加原生宿主标识，用 `reg add` 设默认字符串值。
    // Use reg.exe to add the registry entry
    // https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
    void execFileNoThrowWithCwd('reg', [
      'add',
      fullKey,
      '/ve', // Set the default (unnamed) value
      '/t',
      'REG_SZ',
      '/d',
      manifestPath,
      '/f', // Force overwrite without prompt
    ]).then(result => {
      if (result.code === 0) {
        logForDebugging(
          `[Claude in Chrome] Registered native host for ${browser} in Windows registry: ${fullKey}`,
        )
      } else {
        logForDebugging(
          `[Claude in Chrome] Failed to register native host for ${browser} in Windows registry: ${result.stderr}`,
        )
      }
    })
  }
}

/**
 * Create a wrapper script in ~/.claude/chrome/ that invokes the given command. This is
 * necessary because Chrome's native host manifest "path" field cannot contain arguments.
 *
 * @param command - The full command to execute (e.g., "/path/to/claude --chrome-native-host")
 * @returns The path to the wrapper script
 */
// `createWrapperScript`：在 `~/.claude/chrome/` 生成包装脚本，因清单 `path` 不能带参数，故用脚本封装完整命令；Windows 用 bat，其他用 sh 并加执行位。
async function createWrapperScript(command: string): Promise<string> {
  const platform = getPlatform()
  const chromeDir = join(getClaudeConfigHomeDir(), 'chrome')
// 包装脚本放在配置主目录下的 `chrome` 子目录。
  const wrapperPath =
    platform === 'windows'
      ? join(chromeDir, 'chrome-native-host.bat')
      : join(chromeDir, 'chrome-native-host')

  const scriptContent =
    platform === 'windows'
      ? `@echo off
REM Chrome native host wrapper script
REM Generated by Claude Code - do not edit manually
${command}
`
      : `#!/bin/sh
# Chrome native host wrapper script
# Generated by Claude Code - do not edit manually
exec ${command}
`
// Windows 写 `@echo off` 批处理、其他写 `#!/bin/sh` 脚本，内容含被封装的命令。

  // Check if content matches to avoid unnecessary writes
  const existingContent = await readFile(wrapperPath, 'utf-8').catch(() => null)
// 读取已有脚本内容，一致就直接复用不重写。
  if (existingContent === scriptContent) {
    return wrapperPath
  }

  await mkdir(chromeDir, { recursive: true })
  await writeFile(wrapperPath, scriptContent)

  if (platform !== 'windows') {
// 非 Windows 给包装脚本加 `0o755` 执行位。
    await chmod(wrapperPath, 0o755)
  }

  logForDebugging(
    `[Claude in Chrome] Created Chrome native host wrapper script: ${wrapperPath}`,
  )
  return wrapperPath
}

/**
 * Get cached value of whether Chrome extension is installed. Returns
 * from disk cache immediately, updates cache in background.
 *
 * Use this for sync/startup-critical paths where blocking on filesystem
 * access is not acceptable. The value may be stale if the cache hasn't
 * been updated recently.
 *
 * Only positive detections are persisted. A negative result from the
 * filesystem scan is not cached, because it may come from a machine that
 * shares ~/.claude.json but has no local Chrome (e.g. a remote dev
 * environment using the bridge), and caching it would permanently poison
 * auto-enable for every session on every machine that reads that config.
 */
// `isChromeExtensionInstalled_CACHED_MAY_BE_STALE`：同步/启动关键路径用，立即返回磁盘缓存值、后台刷新缓存；只持久化正向检测结果以免误毒化自动启用。
function isChromeExtensionInstalled_CACHED_MAY_BE_STALE(): boolean {
  // Update cache in background without blocking
  void isChromeExtensionInstalled().then(isInstalled => {
// 后台异步探测扩展是否安装，只有装了才回写缓存（负结果不缓存，避免共享配置污染其他机器）。
    // Only persist positive detections — see docstring. The cost of a stale
    // `true` is one silent MCP connection attempt per session; the cost of a
    // stale `false` is auto-enable never working again without manual repair.
    if (!isInstalled) {
      return
    }
    const config = getGlobalConfig()
    if (config.cachedChromeExtensionInstalled !== isInstalled) {
      saveGlobalConfig(prev => ({
        ...prev,
        cachedChromeExtensionInstalled: isInstalled,
      }))
    }
  })

  // Return cached value immediately from disk
  const cached = getGlobalConfig().cachedChromeExtensionInstalled
// 同步返回缓存值，未缓存时按未安装处理。
  return cached ?? false
}

/**
 * Detects if the Claude in Chrome extension is installed by checking the Extensions
 * directory across all supported Chromium-based browsers and their profiles.
 *
 * @returns Object with isInstalled boolean and the browser where the extension was found
 */
// `isChromeExtensionInstalled`：遍历所有受支持 Chromium 浏览器的扩展目录探测扩展是否安装，无目录则平台不支持返回否。
export async function isChromeExtensionInstalled(): Promise<boolean> {
  const browserPaths = getAllBrowserDataPaths()
  if (browserPaths.length === 0) {
    logForDebugging(
      `[Claude in Chrome] Unsupported platform for extension detection: ${getPlatform()}`,
    )
    return false
  }
  return isChromeExtensionInstalledPortable(browserPaths, logForDebugging)
// 把浏览器数据路径交给可移植的探测实现，返回是否安装。
}
