import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import axios from 'axios'
import { execa } from 'execa'
import capitalize from 'lodash-es/capitalize.js'
import memoize from 'lodash-es/memoize.js'
import { createConnection } from 'net'
import * as os from 'os'
import { basename, join, sep as pathSeparator, resolve } from 'path'
import { logEvent } from 'src/services/analytics/index.js'
import { getIsScrollDraining, getOriginalCwd } from '../bootstrap/state.js'
import { callIdeRpc } from '../services/mcp/client.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
} from '../services/mcp/types.js'
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { env } from './env.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import {
  execFileNoThrow,
  execFileNoThrowWithCwd,
  execSyncWithDefaults_DEPRECATED,
} from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import { getAncestorPidsAsync } from './genericProcessUtils.js'
import { isJetBrainsPluginInstalledCached } from './jetbrains.js'
import { logError } from './log.js'
import { getPlatform } from './platform.js'
import { lt } from './semver.js'

// Lazy: IdeOnboardingDialog.tsx pulls React/ink; only needed in interactive onboarding path
/* eslint-disable @typescript-eslint/no-require-imports */
const ideOnboardingDialog =
  (): typeof import('src/components/IdeOnboardingDialog.js') =>
    require('src/components/IdeOnboardingDialog.js')

import { createAbortController } from './abortController.js'
import { logForDebugging } from './debug.js'
import { envDynamic } from './envDynamic.js'
import { errorMessage, isFsInaccessible } from './errors.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import {
  checkWSLDistroMatch,
  WindowsToWSLConverter,
} from './idePathConversion.js'
import { sleep } from './sleep.js'
import { jsonParse } from './slowOperations.js'
// 文件总览：IDE 集成的发现层。核心是一条「非信任通道」——IDE 侧的扩展会在本机写锁文件（端口 + 工作区路径 + pid + 可选 authToken），CLI 靠扫描这些锁文件反向找到「哪个编辑器窗口在跑着我」。整条链有四道筛：① 锁文件按 mtime 排序（新窗口优先）；② 端口探活（TCP connect 500ms）；③ 工作区路径前缀匹配（NFC 归一，防 macOS 的 NFD 与 IDE 的 NFC 拼不上）；④ 进程祖先链匹配（多个窗口工作区重叠时靠 parent pid 区分）。四道都过才认。

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
// 进程探活用 signal 0：不真发信号，只让内核校验「该 pid 存在且我有权限」。ESRCH 抛错即进程已死。比 ps 快三个数量级，是后面所有 pid 校验的原子操作。

// Returns a function that lazily fetches our process's ancestor PID chain,
// caching within the closure's lifetime. Callers should scope this to a
// single detection pass — PIDs recycle and process trees change over time.
function makeAncestorPidLookup(): () => Promise<Set<number>> {
  let promise: Promise<Set<number>> | null = null
  return () => {
    if (!promise) {
      promise = getAncestorPidsAsync(process.ppid, 10).then(
        pids => new Set(pids),
      )
    }
    return promise
  }
}
// 祖先链查询做成惰性单发闭包，注释写清了理由：pid 会回收、进程树会变，所以只能在**一次检测过程**内缓存。返回的是 Set 而不是数组，因为后面只做 has 查询。getAncestorPidsAsync 从 ppid 起向上走最多 10 层。

type LockfileJsonContent = {
  workspaceFolders?: string[]
  pid?: number
  ideName?: string
  transport?: 'ws' | 'sse'
  runningInWindows?: boolean
  authToken?: string
}

type IdeLockfileInfo = {
  workspaceFolders: string[]
  port: number
  pid?: number
  ideName?: string
  useWebSocket: boolean
  runningInWindows: boolean
  authToken?: string
}
// IdeLockfileInfo 与上面的 LockfileJsonContent 是两个视角：前者是「解析后保证有 port 与 workspaceFolders」的内部形态，后者是「磁盘上可能缺字段」的原始 JSON。分离两型的价值是让 port 的类型从 string 收窄成 number，不必在每次使用时再转。

export type DetectedIDEInfo = {
  name: string
  port: number
  workspaceFolders: string[]
  url: string
  isValid: boolean
  authToken?: string
  ideRunningInWindows?: boolean
}
// DetectedIDEInfo 是对外契约：url 已按传输层拼好（ws 或 sse），isValid 表示「工作区是否匹配当前 cwd」——注意它是**结果字段**而非过滤条件，includeInvalid 为真时非法项也会返回给调用方去做 UI 展示。

export type IdeType =
  | 'cursor'
  | 'windsurf'
  | 'vscode'
  | 'pycharm'
  | 'intellij'
  | 'webstorm'
  | 'phpstorm'
  | 'rubymine'
  | 'clion'
  | 'goland'
  | 'rider'
  | 'datagrip'
  | 'appcode'
  | 'dataspell'
  | 'aqua'
  | 'gateway'
  | 'fleet'
  | 'androidstudio'

type IdeConfig = {
  ideKind: 'vscode' | 'jetbrains'
  displayName: string
  processKeywordsMac: string[]
  processKeywordsWindows: string[]
  processKeywordsLinux: string[]
}
// IdeConfig 把「按平台的关键词表」收进一个结构：macOS 用 ps aux 的完整命令行，Windows 用 tasklist 的映像名，Linux 用 ps 的进程名。三平台关键词差异巨大（同一个 Cursor 在 mac 是 Cursor Helper、Windows 是 cursor.exe），所以不能共用一张表。

const supportedIdeConfigs: Record<IdeType, IdeConfig> = {
  cursor: {
    ideKind: 'vscode',
    displayName: 'Cursor',
    processKeywordsMac: ['Cursor Helper', 'Cursor.app'],
    processKeywordsWindows: ['cursor.exe'],
    processKeywordsLinux: ['cursor'],
  },
  windsurf: {
    ideKind: 'vscode',
    displayName: 'Windsurf',
    processKeywordsMac: ['Windsurf Helper', 'Windsurf.app'],
    processKeywordsWindows: ['windsurf.exe'],
    processKeywordsLinux: ['windsurf'],
  },
  vscode: {
    ideKind: 'vscode',
    displayName: 'VS Code',
    processKeywordsMac: ['Visual Studio Code', 'Code Helper'],
    processKeywordsWindows: ['code.exe'],
    processKeywordsLinux: ['code'],
  },
  intellij: {
    ideKind: 'jetbrains',
    displayName: 'IntelliJ IDEA',
    processKeywordsMac: ['IntelliJ IDEA'],
    processKeywordsWindows: ['idea64.exe'],
    processKeywordsLinux: ['idea', 'intellij'],
  },
  pycharm: {
    ideKind: 'jetbrains',
    displayName: 'PyCharm',
    processKeywordsMac: ['PyCharm'],
    processKeywordsWindows: ['pycharm64.exe'],
    processKeywordsLinux: ['pycharm'],
  },
  webstorm: {
    ideKind: 'jetbrains',
    displayName: 'WebStorm',
    processKeywordsMac: ['WebStorm'],
    processKeywordsWindows: ['webstorm64.exe'],
    processKeywordsLinux: ['webstorm'],
  },
  phpstorm: {
    ideKind: 'jetbrains',
    displayName: 'PhpStorm',
    processKeywordsMac: ['PhpStorm'],
    processKeywordsWindows: ['phpstorm64.exe'],
    processKeywordsLinux: ['phpstorm'],
  },
  rubymine: {
    ideKind: 'jetbrains',
    displayName: 'RubyMine',
    processKeywordsMac: ['RubyMine'],
    processKeywordsWindows: ['rubymine64.exe'],
    processKeywordsLinux: ['rubymine'],
  },
  clion: {
    ideKind: 'jetbrains',
    displayName: 'CLion',
    processKeywordsMac: ['CLion'],
    processKeywordsWindows: ['clion64.exe'],
    processKeywordsLinux: ['clion'],
  },
  goland: {
    ideKind: 'jetbrains',
    displayName: 'GoLand',
    processKeywordsMac: ['GoLand'],
    processKeywordsWindows: ['goland64.exe'],
    processKeywordsLinux: ['goland'],
  },
  rider: {
    ideKind: 'jetbrains',
    displayName: 'Rider',
    processKeywordsMac: ['Rider'],
    processKeywordsWindows: ['rider64.exe'],
    processKeywordsLinux: ['rider'],
  },
  datagrip: {
    ideKind: 'jetbrains',
    displayName: 'DataGrip',
    processKeywordsMac: ['DataGrip'],
    processKeywordsWindows: ['datagrip64.exe'],
    processKeywordsLinux: ['datagrip'],
  },
  appcode: {
    ideKind: 'jetbrains',
    displayName: 'AppCode',
    processKeywordsMac: ['AppCode'],
    processKeywordsWindows: ['appcode.exe'],
    processKeywordsLinux: ['appcode'],
  },
  dataspell: {
    ideKind: 'jetbrains',
    displayName: 'DataSpell',
    processKeywordsMac: ['DataSpell'],
    processKeywordsWindows: ['dataspell64.exe'],
    processKeywordsLinux: ['dataspell'],
  },
  aqua: {
    ideKind: 'jetbrains',
    displayName: 'Aqua',
    processKeywordsMac: [], // Do not auto-detect since aqua is too common
    processKeywordsWindows: ['aqua64.exe'],
    processKeywordsLinux: [],
  },
  gateway: {
    ideKind: 'jetbrains',
    displayName: 'Gateway',
    processKeywordsMac: [], // Do not auto-detect since gateway is too common
    processKeywordsWindows: ['gateway64.exe'],
    processKeywordsLinux: [],
  },
  fleet: {
    ideKind: 'jetbrains',
    displayName: 'Fleet',
    processKeywordsMac: [], // Do not auto-detect since fleet is too common
    processKeywordsWindows: ['fleet.exe'],
    processKeywordsLinux: [],
  },
  androidstudio: {
    ideKind: 'jetbrains',
    displayName: 'Android Studio',
    processKeywordsMac: ['Android Studio'],
    processKeywordsWindows: ['studio64.exe'],
    processKeywordsLinux: ['android-studio'],
  },
}
// 十八种 IDE 的静态注册表。三处细节值得记：① aqua / gateway / fleet 的 macOS 关键词是空数组，注释写「太常见不自动检测」——一个叫 aqua 的进程在 mac 上满地都是，纳入检测会天天误报；② Cursor 与 Windsurf 是 vscode 分支（复用同一套扩展协议），因此 ideKind 决定用哪条安装/探测路径；③ Android Studio 的 Linux 关键词是 android-studio（带连字符），而 Windows 是 studio64.exe，命名毫无规律可言。

export function isVSCodeIde(ide: IdeType | null): boolean {
  if (!ide) return false
  const config = supportedIdeConfigs[ide]
  return config && config.ideKind === 'vscode'
}
// isVSCodeIde 与下面的 isJetBrainsIde 是仅有的两个「类型 → 家族」判定，全部下游分支（装扩展、查版本、探测终端）都靠它们分叉。写成查表而非 switch，新增 IDE 只改一处表。

export function isJetBrainsIde(ide: IdeType | null): boolean {
  if (!ide) return false
  const config = supportedIdeConfigs[ide]
  return config && config.ideKind === 'jetbrains'
}
// JetBrains 家族判定。它与 vscode 家族的关键差别：JetBrains 插件**无自动安装**（原生构建里不支持），只能提示用户去市场手动装，所以这条判定后面跟着的全是「只读探测」路径。

export const isSupportedVSCodeTerminal = memoize(() => {
  return isVSCodeIde(env.terminal as IdeType)
})

export const isSupportedJetBrainsTerminal = memoize(() => {
  return isJetBrainsIde(envDynamic.terminal as IdeType)
})

export const isSupportedTerminal = memoize(() => {
  return (
    isSupportedVSCodeTerminal() ||
    isSupportedJetBrainsTerminal() ||
    Boolean(process.env.FORCE_CODE_TERMINAL)
  )
})
// isSupportedTerminal 是三个条件的并：VSCode 系终端、JetBrains 系终端、或环境变量 FORCE_CODE_TERMINAL。第三个是逃生门——终端识别失败（比如 tmux 里 TERM_PROGRAM 被吃掉）时手工强制进入「受支持终端」分支。memoize 是因为它在渲染热路径上被反复调用。

export function getTerminalIdeType(): IdeType | null {
  if (!isSupportedTerminal()) {
    return null
  }
  return env.terminal as IdeType
}
// getTerminalIdeType 与上面的 isSupportedTerminal 有一个隐蔽的不一致：判定与取名走**不同的环境源**——判定用 env.terminal，取名也返回 env.terminal，而 JetBrains 的判定用的是 envDynamic.terminal（动态重读）。动态版存在的理由是某些终端会中途改写 TERM_PROGRAM。

/**
 * Gets sorted IDE lockfiles from ~/.claude/ide directory
 * @returns Array of full lockfile paths sorted by modification time (newest first)
 */
export async function getSortedIdeLockfiles(): Promise<string[]> {
  try {
    const ideLockFilePaths = await getIdeLockfilesPaths()

    // Collect all lockfiles from all directories
    const allLockfiles: Array<{ path: string; mtime: Date }>[] =
      await Promise.all(
        ideLockFilePaths.map(async ideLockFilePath => {
          try {
            const entries = await getFsImplementation().readdir(ideLockFilePath)
            const lockEntries = entries.filter(file =>
              file.name.endsWith('.lock'),
            )
            // Stat all lockfiles in parallel; skip ones that fail
            const stats = await Promise.all(
              lockEntries.map(async file => {
                const fullPath = join(ideLockFilePath, file.name)
                try {
                  const fileStat = await getFsImplementation().stat(fullPath)
                  return { path: fullPath, mtime: fileStat.mtime }
                } catch {
                  return null
                }
              }),
            )
            return stats.filter(s => s !== null)
          } catch (error) {
            // Candidate paths are pushed without pre-checking existence, so
            // missing/inaccessible dirs are expected here — skip silently.
            if (!isFsInaccessible(error)) {
              logError(error)
            }
            return []
          }
        }),
      )

    // Flatten and sort all lockfiles by last modified date (newest first)
    return allLockfiles
      .flat()
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
      .map(file => file.path)
  } catch (error) {
    logError(error as Error)
    return []
  }
}
// getSortedIdeLockfiles：跨多个候选目录并发 readdir + stat，展平后按 mtime 降序。两个设计点：① 目录不存在属于预期（候选路径不做存在性预检，见后面 getIdeLockfilesPaths 的注释），用 isFsInaccessible 静默跳过，否则每次启动都刷一堆 logError；② 单个锁文件的 stat 失败返回 null 再 filter，避免一个坏文件毁掉整批。

async function readIdeLockfile(path: string): Promise<IdeLockfileInfo | null> {
  try {
    const content = await getFsImplementation().readFile(path, {
      encoding: 'utf-8',
    })

    let workspaceFolders: string[] = []
    let pid: number | undefined
    let ideName: string | undefined
    let useWebSocket = false
    let runningInWindows = false
    let authToken: string | undefined

    try {
      const parsedContent = jsonParse(content) as LockfileJsonContent
      if (parsedContent.workspaceFolders) {
        workspaceFolders = parsedContent.workspaceFolders
      }
      pid = parsedContent.pid
      ideName = parsedContent.ideName
      useWebSocket = parsedContent.transport === 'ws'
      runningInWindows = parsedContent.runningInWindows === true
      authToken = parsedContent.authToken
    } catch (_) {
      // Older format- just a list of paths.
      workspaceFolders = content.split('\n').map(line => line.trim())
    }

    // Extract the port from the filename (e.g., 12345.lock -> 12345)
    const filename = path.split(pathSeparator).pop()
    if (!filename) return null

    const port = filename.replace('.lock', '')

    return {
      workspaceFolders,
      port: parseInt(port),
      pid,
      ideName,
      useWebSocket,
      runningInWindows,
      authToken,
    }
  } catch (error) {
    logError(error as Error)
    return null
  }
}
// readIdeLockfile 兼容两代格式：新格式是 JSON（workspaceFolders / pid / ideName / transport / authToken），老格式是**纯文本路径列表**（一行一个）。解析失败就按行切分当路径——这不是兜底而是明确的向后兼容，因为老版本扩展还在用户机器上跑。端口不在文件里，从文件名 12345.lock 反推。

/**
 * Checks if the IDE connection is responding by testing if the port is open
 * @param host Host to connect to
 * @param port Port to connect to
 * @param timeout Optional timeout in milliseconds (defaults to 500ms)
 * @returns true if the port is open, false otherwise
 */
async function checkIdeConnection(
  host: string,
  port: number,
  timeout = 500,
): Promise<boolean> {
  try {
    return new Promise(resolve => {
      const socket = createConnection({
        host: host,
        port: port,
        timeout: timeout,
      })

      socket.on('connect', () => {
        socket.destroy()
        void resolve(true)
      })

      socket.on('error', () => {
        void resolve(false)
      })

      socket.on('timeout', () => {
        socket.destroy()
        void resolve(false)
      })
    })
  } catch (_) {
    // Invalid URL or other errors
    return false
  }
}
// checkIdeConnection 用裸 TCP 连接代替 HTTP 请求：扩展可能只监听 ws、或者 HTTP 路由会 404，但端口开没开是统一的判据。三个回调都显式 destroy socket，否则 timeout 之后句柄会漏。默认 500ms 是探测预算——启动阶段要扫十几个锁文件，不能每个都等几秒。

/**
 * Resolve the Windows USERPROFILE path. WSL often doesn't pass USERPROFILE
 * through, so fall back to shelling out to powershell.exe. That spawn is
 * ~500ms–2s cold; the value is static per session.
 */
const getWindowsUserProfile = memoize(async (): Promise<string | undefined> => {
  if (process.env.USERPROFILE) return process.env.USERPROFILE
  const { stdout, code } = await execFileNoThrow('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '$env:USERPROFILE',
  ])
  if (code === 0 && stdout.trim()) return stdout.trim()
  logForDebugging(
    'Unable to get Windows USERPROFILE via PowerShell - IDE detection may be incomplete',
  )
  return undefined
})
// getWindowsUserProfile 专治 WSL：WSL 进程通常拿不到 Windows 的 USERPROFILE，只能 shell 出 powershell.exe 去问。注释标了代价（冷启动 0.5–2 秒）并因此 memoize——每会话只付一次。这是「WSL 里找 Windows 侧配置」的通用成本模型：跨边界查询都慢，必须缓存。

/**
 * Gets the potential IDE lockfiles directories path based on platform.
 * Paths are not pre-checked for existence — the consumer readdirs each
 * and handles ENOENT. Pre-checking with stat() would double syscalls,
 * and on WSL (where /mnt/c access is 2-10x slower) the per-user-dir
 * stat loop compounded startup latency.
 */
export async function getIdeLockfilesPaths(): Promise<string[]> {
  const paths: string[] = [join(getClaudeConfigHomeDir(), 'ide')]

  if (getPlatform() !== 'wsl') {
    return paths
  }

  // For Windows, use heuristics to find the potential paths.
  // See https://learn.microsoft.com/en-us/windows/wsl/filesystems

  const windowsHome = await getWindowsUserProfile()

  if (windowsHome) {
    const converter = new WindowsToWSLConverter(process.env.WSL_DISTRO_NAME)
    const wslPath = converter.toLocalPath(windowsHome)
    paths.push(resolve(wslPath, '.claude', 'ide'))
  }

  // Construct the path based on the standard Windows WSL locations
  // This can fail if the current user does not have "List folder contents" permission on C:\Users
  try {
    const usersDir = '/mnt/c/Users'
    const userDirs = await getFsImplementation().readdir(usersDir)

    for (const user of userDirs) {
      // Skip files (e.g. desktop.ini) — readdir on a file path throws ENOTDIR.
      // isFsInaccessible covers ENOTDIR, but pre-filtering here avoids the
      // cost of attempting to readdir non-directories. Symlinks are kept since
      // Windows creates junction points for user profiles.
      if (!user.isDirectory() && !user.isSymbolicLink()) {
        continue
      }
      if (
        user.name === 'Public' ||
        user.name === 'Default' ||
        user.name === 'Default User' ||
        user.name === 'All Users'
      ) {
        continue // Skip system directories
      }
      paths.push(join(usersDir, user.name, '.claude', 'ide'))
    }
  } catch (error: unknown) {
    if (isFsInaccessible(error)) {
      // Expected on WSL when C: drive is not mounted or user lacks permissions
      logForDebugging(
        `WSL IDE lockfile path detection failed (${error.code}): ${errorMessage(error)}`,
      )
    } else {
      logError(error)
    }
  }
  return paths
}
// getIdeLockfilesPaths 的注释是本文件最有价值的一段工程账：候选路径**故意不做存在性预检**，交给消费方 readdir 吃 ENOENT。理由是 WSL 下 /mnt/c 访问慢 2–10 倍，而逐个用户目录 stat 的循环会把启动延迟叠起来——预检省下的是「错误日志噪音」，付出的是「每会话几十次跨文件系统 syscall」。这个取舍方向在跨边界场景里普遍成立。

/**
 * Cleans up stale IDE lockfiles
 * - Removes lockfiles for processes that are no longer running
 * - Removes lockfiles for ports that are not responding
 */
export async function cleanupStaleIdeLockfiles(): Promise<void> {
  try {
    const lockfiles = await getSortedIdeLockfiles()

    for (const lockfilePath of lockfiles) {
      const lockfileInfo = await readIdeLockfile(lockfilePath)

      if (!lockfileInfo) {
        // If we can't read the lockfile, delete it
        try {
          await getFsImplementation().unlink(lockfilePath)
        } catch (error) {
          logError(error as Error)
        }
        continue
      }

      const host = await detectHostIP(
        lockfileInfo.runningInWindows,
        lockfileInfo.port,
      )

      let shouldDelete = false

      if (lockfileInfo.pid) {
        // Check if the process is still running
        if (!isProcessRunning(lockfileInfo.pid)) {
          if (getPlatform() !== 'wsl') {
            shouldDelete = true
          } else {
            // The process id may not be reliable in wsl, so also check the connection
            const isResponding = await checkIdeConnection(
              host,
              lockfileInfo.port,
            )
            if (!isResponding) {
              shouldDelete = true
            }
          }
        }
      } else {
        // No PID, check if the URL is responding
        const isResponding = await checkIdeConnection(host, lockfileInfo.port)
        if (!isResponding) {
          shouldDelete = true
        }
      }

      if (shouldDelete) {
        try {
          await getFsImplementation().unlink(lockfilePath)
        } catch (error) {
          logError(error as Error)
        }
      }
    }
  } catch (error) {
    logError(error as Error)
  }
}
// cleanupStaleIdeLockfiles：清理顺序是先判 pid 再判端口。WSL 特例值得记——Windows 侧 pid 在 WSL 里没有意义（pid 命名空间不同），所以「进程不在了」不能作为删除依据，必须再补一次 TCP 探活，两者都失败才删。这是 WSL 双命名空间带来的判据叠加。

export interface IDEExtensionInstallationStatus {
  installed: boolean
  error: string | null
  installedVersion: string | null
  ideType: IdeType | null
}
// IDEExtensionInstallationStatus 把「失败」也建模成正常返回值（installed=false + error），而不是抛异常。调用方（启动流程）需要在失败时仍然走完 UI 分支（提示手动安装），异常会打断这条链。

export async function maybeInstallIDEExtension(
  ideType: IdeType,
): Promise<IDEExtensionInstallationStatus | null> {
  try {
    // Install/update the extension
    const installedVersion = await installIDEExtension(ideType)
    // Only track successful installations
    logEvent('tengu_ext_installed', {})

    // Set diff tool config to auto if it has not been set already
    const globalConfig = getGlobalConfig()
    if (!globalConfig.diffTool) {
      saveGlobalConfig(current => ({ ...current, diffTool: 'auto' }))
    }
    return {
      installed: true,
      error: null,
      installedVersion,
      ideType: ideType,
    }
  } catch (error) {
    logEvent('tengu_ext_install_error', {})
    // Handle installation errors
    const errorMessage = error instanceof Error ? error.message : String(error)
    logError(error as Error)
    return {
      installed: false,
      error: errorMessage,
      installedVersion: null,
      ideType: ideType,
    }
  }
}
// maybeInstallIDEExtension 成功路径里顺手把 diffTool 设成 auto（仅当用户没设过）——扩展装上了才配自动 diff，顺序反了会让没装扩展的用户看到报错。埋点也是分开的：tengu_ext_installed / tengu_ext_install_error 两条独立事件，便于算安装成功率。

let currentIDESearch: AbortController | null = null

export async function findAvailableIDE(): Promise<DetectedIDEInfo | null> {
  if (currentIDESearch) {
    currentIDESearch.abort()
  }
  currentIDESearch = createAbortController()
  const signal = currentIDESearch.signal

  // Clean up stale IDE lockfiles first so we don't check them at all.
  await cleanupStaleIdeLockfiles()
  const startTime = Date.now()
  while (Date.now() - startTime < 30_000 && !signal.aborted) {
    // Skip iteration during scroll drain — detectIDEs reads lockfiles +
    // shells out to ps, competing for the event loop with scroll frames.
    // Next tick after scroll settles resumes the search.
    if (getIsScrollDraining()) {
      await sleep(1000, signal)
      continue
    }
    const ides = await detectIDEs(false)
    if (signal.aborted) {
      return null
    }
    // Return the IDE if and only if there is exactly one match, otherwise the user must
    // use /ide to select an IDE. When running from a supported built-in terminal, detectIDEs()
    // should return at most one IDE.
    if (ides.length === 1) {
      return ides[0]!
    }
    await sleep(1000, signal)
  }
  return null
}
// findAvailableIDE：30 秒轮询窗口，每秒扫一次，**只有恰好一个匹配才返回**。多于一个就返回 null 让用户走 /ide 手动选——自动连错窗口比连不上更糟（会把 diff 打到别人的工作区）。两处细节：① 新一轮搜索先 abort 上一轮的 AbortController，避免旧循环继续跑；② getIsScrollDraining 为真时跳过本轮——detectIDEs 会 shell 出 ps，与滚动帧抢事件循环。

/**
 * Detects IDEs that have a running extension/plugin.
 * @param includeInvalid If true, also return IDEs that are invalid (ie. where
 * the workspace directory does not match the cwd)
 */
export async function detectIDEs(
  includeInvalid: boolean,
): Promise<DetectedIDEInfo[]> {
  const detectedIDEs: DetectedIDEInfo[] = []

  try {
    // Get the CLAUDE_CODE_SSE_PORT if set
    const ssePort = process.env.CLAUDE_CODE_SSE_PORT
    const envPort = ssePort ? parseInt(ssePort) : null

    // Get the current working directory, normalized to NFC for consistent
    // comparison. macOS returns NFD paths (decomposed Unicode), while IDEs
    // like VS Code report NFC paths (composed Unicode). Without normalization,
    // paths containing accented/CJK characters fail to match.
    const cwd = getOriginalCwd().normalize('NFC')

    // Get sorted lockfiles (full paths) and read them all in parallel.
    // findAvailableIDE() polls this every 1s for up to 30s; serial I/O here was
    // showing up as ~500ms self-time in CPU profiles.
    const lockfiles = await getSortedIdeLockfiles()
    const lockfileInfos = await Promise.all(lockfiles.map(readIdeLockfile))

    // Ancestor PID walk shells out (ps in a loop, up to 10x). Make it lazy and
    // single-shot per detectIDEs() call; with the workspace-check-first ordering
    // below, this often never fires at all.
    const getAncestors = makeAncestorPidLookup()
    const needsAncestryCheck = getPlatform() !== 'wsl' && isSupportedTerminal()

    // Try to find a lockfile that contains our current working directory
    for (const lockfileInfo of lockfileInfos) {
      if (!lockfileInfo) continue

      let isValid = false
      if (isEnvTruthy(process.env.CLAUDE_CODE_IDE_SKIP_VALID_CHECK)) {
        isValid = true
      } else if (lockfileInfo.port === envPort) {
        // If the port matches the environment variable, mark as valid regardless of directory
        isValid = true
      } else {
        // Otherwise, check if the current working directory is within the workspace folders
        isValid = lockfileInfo.workspaceFolders.some(idePath => {
          if (!idePath) return false

          let localPath = idePath

          // Handle WSL-specific path conversion and distro matching
          if (
            getPlatform() === 'wsl' &&
            lockfileInfo.runningInWindows &&
            process.env.WSL_DISTRO_NAME
          ) {
            // Check for WSL distro mismatch
            if (!checkWSLDistroMatch(idePath, process.env.WSL_DISTRO_NAME)) {
              return false
            }

            // Try both the original path and the converted path
            // This handles cases where the IDE might report either format
            const resolvedOriginal = resolve(localPath).normalize('NFC')
            if (
              cwd === resolvedOriginal ||
              cwd.startsWith(resolvedOriginal + pathSeparator)
            ) {
              return true
            }

            // Convert Windows IDE path to WSL local path and check that too
            const converter = new WindowsToWSLConverter(
              process.env.WSL_DISTRO_NAME,
            )
            localPath = converter.toLocalPath(idePath)
          }

          const resolvedPath = resolve(localPath).normalize('NFC')

          // On Windows, normalize paths for case-insensitive drive letter comparison
          if (getPlatform() === 'windows') {
            const normalizedCwd = cwd.replace(/^[a-zA-Z]:/, match =>
              match.toUpperCase(),
            )
            const normalizedResolvedPath = resolvedPath.replace(
              /^[a-zA-Z]:/,
              match => match.toUpperCase(),
            )
            return (
              normalizedCwd === normalizedResolvedPath ||
              normalizedCwd.startsWith(normalizedResolvedPath + pathSeparator)
            )
          }

          return (
            cwd === resolvedPath || cwd.startsWith(resolvedPath + pathSeparator)
          )
        })
      }

      if (!isValid && !includeInvalid) {
        continue
      }

      // PID ancestry check: when running in a supported IDE's built-in terminal,
      // ensure this lockfile's IDE is actually our parent process. This
      // disambiguates when multiple IDE windows have overlapping workspace folders.
      // Runs AFTER the workspace check so non-matching lockfiles skip it entirely —
      // previously this shelled out once per lockfile and dominated CPU profiles
      // during findAvailableIDE() polling.
      if (needsAncestryCheck) {
        const portMatchesEnv = envPort !== null && lockfileInfo.port === envPort
        if (!portMatchesEnv) {
          if (!lockfileInfo.pid || !isProcessRunning(lockfileInfo.pid)) {
            continue
          }
          if (process.ppid !== lockfileInfo.pid) {
            const ancestors = await getAncestors()
            if (!ancestors.has(lockfileInfo.pid)) {
              continue
            }
          }
        }
      }

      const ideName =
        lockfileInfo.ideName ??
        (isSupportedTerminal() ? toIDEDisplayName(envDynamic.terminal) : 'IDE')

      const host = await detectHostIP(
        lockfileInfo.runningInWindows,
        lockfileInfo.port,
      )
      let url
      if (lockfileInfo.useWebSocket) {
        url = `ws://${host}:${lockfileInfo.port}`
      } else {
        url = `http://${host}:${lockfileInfo.port}/sse`
      }

      detectedIDEs.push({
        url: url,
        name: ideName,
        workspaceFolders: lockfileInfo.workspaceFolders,
        port: lockfileInfo.port,
        isValid: isValid,
        authToken: lockfileInfo.authToken,
        ideRunningInWindows: lockfileInfo.runningInWindows,
      })
    }

    // The envPort should be defined for supported IDE terminals. If there is
    // an extension with a matching envPort, then we will single that one out
    // and return it, otherwise we return all the valid ones.
    if (!includeInvalid && envPort) {
      const envPortMatch = detectedIDEs.filter(
        ide => ide.isValid && ide.port === envPort,
      )
      if (envPortMatch.length === 1) {
        return envPortMatch
      }
    }
  } catch (error) {
    logError(error as Error)
  }

  return detectedIDEs
}
// detectIDEs 是整条发现链的汇合点。四层判据的**顺序**是性能设计：工作区路径匹配（纯内存）放在最前，进程祖先链（要 shell 出 ps，最多 10 次）放在最后且惰性触发——注释明确写了，早先这个 shell 调用在每个锁文件上都跑一次，是 CPU profile 里的头号热点。另有三个正确性细节：① cwd 与 IDE 路径都 normalize 成 NFC，否则带重音/CJK 的路径永远匹配不上；② Windows 下把盘符统一大写再比，因为 C: 与 c: 是同一盘；③ 端口与 CLAUDE_CODE_SSE_PORT 一致时跳过工作区校验（显式指定优先）。

export async function maybeNotifyIDEConnected(client: Client) {
  await client.notification({
    method: 'ide_connected',
    params: {
      pid: process.pid,
    },
  })
}
// maybeNotifyIDEConnected：连上之后反向通知扩展自己的 pid，让扩展侧知道「是谁连进来的」。扩展据此展示状态栏、挂接 diff 视图。

export function hasAccessToIDEExtensionDiffFeature(
  mcpClients: MCPServerConnection[],
): boolean {
  // Check if there's a connected IDE client in the provided MCP clients list
  return mcpClients.some(
    client => client.type === 'connected' && client.name === 'ide',
  )
}
// hasAccessToIDEExtensionDiffFeature 只看「有没有一个 name 为 ide 的已连接 MCP 客户端」。这个字符串常量是跨进程契约：扩展注册时用的名字必须与此处一致，改名会让 diff 能力静默失效。

const EXTENSION_ID =
  process.env.USER_TYPE === 'ant'
    ? 'anthropic.claude-code-internal'
    : 'anthropic.claude-code'

export async function isIDEExtensionInstalled(
  ideType: IdeType,
): Promise<boolean> {
  if (isVSCodeIde(ideType)) {
    const command = await getVSCodeIDECommand(ideType)
    if (command) {
      try {
        const result = await execFileNoThrowWithCwd(
          command,
          ['--list-extensions'],
          {
            env: getInstallationEnv(),
          },
        )
        if (result.stdout?.includes(EXTENSION_ID)) {
          return true
        }
      } catch {
        // eat the error
      }
    }
  } else if (isJetBrainsIde(ideType)) {
    return await isJetBrainsPluginInstalledCached(ideType)
  }
  return false
}
// isIDEExtensionInstalled 分两族实现：VSCode 系 shell 出 code --list-extensions 看输出里有没有扩展 ID；JetBrains 系查缓存（isJetBrainsPluginInstalledCached）——因为 JetBrains 没有等价 CLI，只能读插件目录。内部构建用不同的扩展 ID（anthropic.claude-code-internal），这是 USER_TYPE 分支的唯一用途。

async function installIDEExtension(ideType: IdeType): Promise<string | null> {
  if (isVSCodeIde(ideType)) {
    const command = await getVSCodeIDECommand(ideType)

    if (command) {
      if (process.env.USER_TYPE === 'ant') {
        return await installFromArtifactory(command)
      }
      let version = await getInstalledVSCodeExtensionVersion(command)
      // If it's not installed or the version is older than the one we have bundled,
      if (!version || lt(version, getClaudeCodeVersion())) {
        // `code` may crash when invoked too quickly in succession
        await sleep(500)
        const result = await execFileNoThrowWithCwd(
          command,
          ['--force', '--install-extension', 'anthropic.claude-code'],
          {
            env: getInstallationEnv(),
          },
        )
        if (result.code !== 0) {
          throw new Error(`${result.code}: ${result.error} ${result.stderr}`)
        }
        version = getClaudeCodeVersion()
      }
      return version
    }
  }
  // No automatic installation for JetBrains IDEs as it is not supported in native
  // builds. We show a prominent notice for them to download from the marketplace
  // instead.
  return null
}
// installIDEExtension 的版本比较是「本地扩展版本 < 当前 CLI 版本就重装」，用 lt 而非不等——降级 CLI 时不该把新扩展替换成旧的。sleep(500) 前注释写着 code 命令连续调用会崩，这是真实踩过的坑。JetBrains 分支直接返回 null：原生构建不支持自动安装。

function getInstallationEnv(): NodeJS.ProcessEnv | undefined {
  // Cursor on Linux may incorrectly implement
  // the `code` command and actually launch the UI.
  // Make this error out if this happens by clearing the DISPLAY
  // environment variable.
  if (getPlatform() === 'linux') {
    return {
      ...process.env,
      DISPLAY: '',
    }
  }
  return undefined
}
// getInstallationEnv 在 Linux 上把 DISPLAY 清空。原因是 Cursor 的 Linux 版可能把 code 命令实现成「打开 GUI」，脚本化调用会意外弹窗；清掉 DISPLAY 让这类误实现直接失败而不是挂在那里。这是个很实用的防御：把「不该启动 GUI」变成环境层面的硬约束。

function getClaudeCodeVersion() {
  return MACRO.VERSION
}
// getClaudeCodeVersion 读构建期注入的 MACRO.VERSION，不是 package.json——打包后 package.json 可能不在，而宏会被内联成字面量。

async function getInstalledVSCodeExtensionVersion(
  command: string,
): Promise<string | null> {
  const { stdout } = await execFileNoThrow(
    command,
    ['--list-extensions', '--show-versions'],
    {
      env: getInstallationEnv(),
    },
  )
  const lines = stdout?.split('\n') || []
  for (const line of lines) {
    const [extensionId, version] = line.split('@')
    if (extensionId === 'anthropic.claude-code' && version) {
      return version
    }
  }
  return null
}
// getInstalledVSCodeExtensionVersion 解析 --show-versions 的输出（格式 publisher.name@1.2.3），按 @ 切分。返回 null 与「版本解析失败」共用同一个信号，调用方一律当「需要重装」处理——这个方向的误判成本低（多重装一次），反向误判会留下不兼容的旧扩展。

function getVSCodeIDECommandByParentProcess(): string | null {
  try {
    const platform = getPlatform()

    // Only supported on OSX, where Cursor has the ability to
    // register itself as the 'code' command.
    if (platform !== 'macos') {
      return null
    }

    let pid = process.ppid

    // Walk up the process tree to find the actual app
    for (let i = 0; i < 10; i++) {
      if (!pid || pid === 0 || pid === 1) break

      // Get the command for this PID
      // this function already returned if not running on macos
      const command = execSyncWithDefaults_DEPRECATED(
        // eslint-disable-next-line custom-rules/no-direct-ps-commands
        `ps -o command= -p ${pid}`,
      )?.trim()

      if (command) {
        // Check for known applications and extract the path up to and including .app
        const appNames = {
          'Visual Studio Code.app': 'code',
          'Cursor.app': 'cursor',
          'Windsurf.app': 'windsurf',
          'Visual Studio Code - Insiders.app': 'code',
          'VSCodium.app': 'codium',
        }
        const pathToExecutable = '/Contents/MacOS/Electron'

        for (const [appName, executableName] of Object.entries(appNames)) {
          const appIndex = command.indexOf(appName + pathToExecutable)
          if (appIndex !== -1) {
            // Extract the path from the beginning to the end of the .app name
            const folderPathEnd = appIndex + appName.length
            // These are all known VSCode variants with the same structure
            return (
              command.substring(0, folderPathEnd) +
              '/Contents/Resources/app/bin/' +
              executableName
            )
          }
        }
      }

      // Get parent PID
      // this function already returned if not running on macos
      const ppidStr = execSyncWithDefaults_DEPRECATED(
        // eslint-disable-next-line custom-rules/no-direct-ps-commands
        `ps -o ppid= -p ${pid}`,
      )?.trim()
      if (!ppidStr) {
        break
      }
      pid = parseInt(ppidStr.trim())
    }

    return null
  } catch {
    return null
  }
}
// getVSCodeIDECommandByParentProcess 是 macOS 专属的「从进程树反推可执行文件路径」：从 ppid 起向上走 10 层，每层 ps -o command= 拿完整命令行，在里面找 Visual Studio Code.app / Cursor.app 等已知包名，命中就拼出 /Contents/Resources/app/bin/<cli>。存在理由是 mac 上这些分支不一定会把 code 命令装进 PATH（Cursor 可以注册成 code）。
async function getVSCodeIDECommand(ideType: IdeType): Promise<string | null> {
  const parentExecutable = getVSCodeIDECommandByParentProcess()
  if (parentExecutable) {
    // Verify the parent executable actually exists
    try {
      await getFsImplementation().stat(parentExecutable)
      return parentExecutable
    } catch {
      // Parent executable doesn't exist
    }
  }

  // On Windows, explicitly request the .cmd wrapper. VS Code 1.110.0 began
  // prepending the install root (containing Code.exe, the Electron GUI binary)
  // to the integrated terminal's PATH ahead of bin\ (containing code.cmd, the
  // CLI wrapper) when launched via Start-Menu/Taskbar shortcuts. A bare 'code'
  // then resolves to Code.exe via PATHEXT which opens a new editor window
  // instead of running the CLI. Asking for 'code.cmd' forces cross-spawn/which
  // to skip Code.exe. See microsoft/vscode#299416 (fixed in Insiders) and
  // anthropics/claude-code#30975.
  const ext = getPlatform() === 'windows' ? '.cmd' : ''
  switch (ideType) {
    case 'vscode':
      return 'code' + ext
    case 'cursor':
      return 'cursor' + ext
    case 'windsurf':
      return 'windsurf' + ext
    default:
      break
  }
  return null
}
// getVSCodeIDECommand 有两条来源，顺序是「父进程反推」优先、PATH 兜底：前者能精确指到当前窗口所属的那个编辑器，后者只能猜。Windows 上额外拼 .cmd 后缀，这段注释值得完整读——VS Code 1.110.0 起在开始菜单启动时会把安装根目录（含 Code.exe，GUI 二进制）插到 PATH 里 bin 目录之前，于是裸 code 经 PATHEXT 解析成 Code.exe，脚本调用变成新开一个编辑器窗口。请求 code.cmd 强制跳过 Code.exe。

export async function isCursorInstalled(): Promise<boolean> {
  const result = await execFileNoThrow('cursor', ['--version'])
  return result.code === 0
}
// isCursorInstalled 用 --version 判存在：退出码 0 即装。

export async function isWindsurfInstalled(): Promise<boolean> {
  const result = await execFileNoThrow('windsurf', ['--version'])
  return result.code === 0
}
// isWindsurfInstalled 同上，windsurf --version。

export async function isVSCodeInstalled(): Promise<boolean> {
  const result = await execFileNoThrow('code', ['--help'])
  // Check if the output indicates this is actually Visual Studio Code
  return (
    result.code === 0 && Boolean(result.stdout?.includes('Visual Studio Code'))
  )
}
// isVSCodeInstalled 多一道校验：不只看退出码，还要求 stdout 里出现 Visual Studio Code 字样。因为很多编辑器（Cursor、Windsurf、各种分支）都注册了 code 命令，只看退出码会把它们全当成 VS Code。

// Cache for IDE detection results
let cachedRunningIDEs: IdeType[] | null = null

/**
 * Internal implementation of IDE detection.
 */
async function detectRunningIDEsImpl(): Promise<IdeType[]> {
  const runningIDEs: IdeType[] = []

  try {
    const platform = getPlatform()
    if (platform === 'macos') {
      // On macOS, use ps with process name matching
      const result = await execa(
        'ps aux | grep -E "Visual Studio Code|Code Helper|Cursor Helper|Windsurf Helper|IntelliJ IDEA|PyCharm|WebStorm|PhpStorm|RubyMine|CLion|GoLand|Rider|DataGrip|AppCode|DataSpell|Aqua|Gateway|Fleet|Android Studio" | grep -v grep',
        { shell: true, reject: false },
      )
      const stdout = result.stdout ?? ''
      for (const [ide, config] of Object.entries(supportedIdeConfigs)) {
        for (const keyword of config.processKeywordsMac) {
          if (stdout.includes(keyword)) {
            runningIDEs.push(ide as IdeType)
            break
          }
        }
      }
    } else if (platform === 'windows') {
      // On Windows, use tasklist with findstr for multiple patterns
      const result = await execa(
        'tasklist | findstr /I "Code.exe Cursor.exe Windsurf.exe idea64.exe pycharm64.exe webstorm64.exe phpstorm64.exe rubymine64.exe clion64.exe goland64.exe rider64.exe datagrip64.exe appcode.exe dataspell64.exe aqua64.exe gateway64.exe fleet.exe studio64.exe"',
        { shell: true, reject: false },
      )
      const stdout = result.stdout ?? ''

      const normalizedStdout = stdout.toLowerCase()

      for (const [ide, config] of Object.entries(supportedIdeConfigs)) {
        for (const keyword of config.processKeywordsWindows) {
          if (normalizedStdout.includes(keyword.toLowerCase())) {
            runningIDEs.push(ide as IdeType)
            break
          }
        }
      }
    } else if (platform === 'linux') {
      // On Linux, use ps with process name matching
      const result = await execa(
        'ps aux | grep -E "code|cursor|windsurf|idea|pycharm|webstorm|phpstorm|rubymine|clion|goland|rider|datagrip|dataspell|aqua|gateway|fleet|android-studio" | grep -v grep',
        { shell: true, reject: false },
      )
      const stdout = result.stdout ?? ''

      const normalizedStdout = stdout.toLowerCase()

      for (const [ide, config] of Object.entries(supportedIdeConfigs)) {
        for (const keyword of config.processKeywordsLinux) {
          if (normalizedStdout.includes(keyword)) {
            if (ide !== 'vscode') {
              runningIDEs.push(ide as IdeType)
              break
            } else if (
              !normalizedStdout.includes('cursor') &&
              !normalizedStdout.includes('appcode')
            ) {
              // Special case conflicting keywords from some of the IDEs.
              runningIDEs.push(ide as IdeType)
              break
            }
          }
        }
      }
    }
  } catch (error) {
    // If process detection fails, return empty array
    logError(error as Error)
  }

  return runningIDEs
}
// detectRunningIDEsImpl 按平台走三条完全不同的命令：mac 与 linux 用 ps aux 管道 grep，Windows 用 tasklist 管道 findstr。三处细节：① reject: false + shell: true，grep 无匹配时退出码非 0，不能让 execa 抛；② Windows 与 Linux 都先 toLowerCase 再比，因为 tasklist 输出大小写不统一；③ Linux 上 vscode 的关键词 code 与 cursor / appcode 冲突，所以特别处理——已经检测到 cursor 或 appcode 时不再把 code 算成 vscode。

/**
 * Detects running IDEs and returns an array of IdeType for those that are running.
 * This performs fresh detection (~150ms) and updates the cache for subsequent
 * detectRunningIDEsCached() calls.
 */
export async function detectRunningIDEs(): Promise<IdeType[]> {
  const result = await detectRunningIDEsImpl()
  cachedRunningIDEs = result
  return result
}
// detectRunningIDEs 做新鲜检测（约 150ms）并**回写缓存**。这个写回是刻意的：调用方主动要新鲜结果时，顺手让后续的缓存读也变新。

/**
 * Returns cached IDE detection results, or performs detection if cache is empty.
 * Use this for performance-sensitive paths like tips where fresh results aren't needed.
 */
export async function detectRunningIDEsCached(): Promise<IdeType[]> {
  if (cachedRunningIDEs === null) {
    return detectRunningIDEs()
  }
  return cachedRunningIDEs
}
// detectRunningIDEsCached 是给性能敏感路径（提示气泡之类）用的：缓存空才真检测。注意它不区分「检测过但为空」与「没检测过」——空数组是有效缓存值，null 才是未初始化。

/**
 * Resets the cache for detectRunningIDEsCached.
 * Exported for testing - allows resetting state between tests.
 */
export function resetDetectRunningIDEs(): void {
  cachedRunningIDEs = null
}
// resetDetectRunningIDEs 导出仅为测试用，注释直说了。生产代码调用它会让进程级缓存失效，代价是一次 150ms 的 ps。

export function getConnectedIdeName(
  mcpClients: MCPServerConnection[],
): string | null {
  const ideClient = mcpClients.find(
    client => client.type === 'connected' && client.name === 'ide',
  )
  return getIdeClientName(ideClient)
}
// getConnectedIdeName 与下面的 getIdeClientName 把「客户端对象 → 显示名」拆两层：前者负责在 MCP 客户端列表里挑出 ide，后者负责从配置或终端环境推出名字。

export function getIdeClientName(
  ideClient?: MCPServerConnection,
): string | null {
  const config = ideClient?.config
  return config?.type === 'sse-ide' || config?.type === 'ws-ide'
    ? config.ideName
    : isSupportedTerminal()
      ? toIDEDisplayName(envDynamic.terminal)
      : null
}
// getIdeClientName 的三级回落：sse-ide / ws-ide 配置里的 ideName → 受支持终端的显示名 → null。第三级返回 null 而不是字符串 IDE，让调用方能区分「不知道」与「知道但名字就叫 IDE」。

const EDITOR_DISPLAY_NAMES: Record<string, string> = {
  code: 'VS Code',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  antigravity: 'Antigravity',
  vi: 'Vim',
  vim: 'Vim',
  nano: 'nano',
  notepad: 'Notepad',
  'start /wait notepad': 'Notepad',
  emacs: 'Emacs',
  subl: 'Sublime Text',
  atom: 'Atom',
}
// EDITOR_DISPLAY_NAMES 是「编辑器命令名 → 展示名」的映射，注意里面混进了 vi / vim / nano / notepad / emacs / subl / atom 这些**非 IDE 编辑器**——它们不是集成对象，但用户把 $EDITOR 设成它们时，UI 里仍要显示个体面的名字而不是裸命令。

export function toIDEDisplayName(terminal: string | null): string {
  if (!terminal) return 'IDE'

  const config = supportedIdeConfigs[terminal as IdeType]
  if (config) {
    return config.displayName
  }

  // Check editor command names (exact match first)
  const editorName = EDITOR_DISPLAY_NAMES[terminal.toLowerCase().trim()]
  if (editorName) {
    return editorName
  }

  // Extract command name from path/arguments (e.g., "/usr/bin/code --wait" -> "code")
  const command = terminal.split(' ')[0]
  const commandName = command ? basename(command).toLowerCase() : null
  if (commandName) {
    const mappedName = EDITOR_DISPLAY_NAMES[commandName]
    if (mappedName) {
      return mappedName
    }
    // Fallback: capitalize the command basename
    return capitalize(commandName)
  }

  // Fallback: capitalize first letter
  return capitalize(terminal)
}
// toIDEDisplayName 的三级解析：IDE 注册表 → 编辑器命令名精确匹配 → 取命令第一个词 basename 再查表 → 首字母大写兜底。第三级专治带参数的终端值（/usr/bin/code --wait），第四级保证永远有可读输出。

export { callIdeRpc }

/**
 * Gets the connected IDE client from a list of MCP clients
 * @param mcpClients - Array of wrapped MCP clients
 * @returns The connected IDE client, or undefined if not found
 */
export function getConnectedIdeClient(
  mcpClients?: MCPServerConnection[],
): ConnectedMCPServer | undefined {
  if (!mcpClients) {
    return undefined
  }

  const ideClient = mcpClients.find(
    client => client.type === 'connected' && client.name === 'ide',
  )

  // Type guard to ensure we return the correct type
  return ideClient?.type === 'connected' ? ideClient : undefined
}
// getConnectedIdeClient 是类型收窄版：返回 ConnectedMCPServer 而非宽泛的 MCPServerConnection，因为下游 callIdeRpc 需要已连接形态。那句类型守卫不是冗余——find 的结果类型仍是宽泛联合。

/**
 * Notifies the IDE that a new prompt has been submitted.
 * This triggers IDE-specific actions like closing all diff tabs.
 */
export async function closeOpenDiffs(
  ideClient: ConnectedMCPServer,
): Promise<void> {
  try {
    await callIdeRpc('closeAllDiffTabs', {}, ideClient)
  } catch (_) {
    // Silently ignore errors when closing diff tabs
    // This prevents exceptions if the IDE doesn't support this operation
  }
}
// closeOpenDiffs 在提交新提示时关掉所有 diff 标签页（RPC 名 closeAllDiffTabs）。错误被完全吞掉：旧版扩展不支持这个方法，关不掉 diff 只是小瑕疵，不该让提交流程失败。

/**
 * Initializes IDE detection and extension installation, then calls the provided callback
 * with the detected IDE information and installation status.
 * @param ideToInstallExtension The ide to install the extension to (if installing from external terminal)
 * @param onIdeDetected Callback to be called when an IDE is detected (including null)
 * @param onInstallationComplete Callback to be called when extension installation is complete
 */
export async function initializeIdeIntegration(
  onIdeDetected: (ide: DetectedIDEInfo | null) => void,
  ideToInstallExtension: IdeType | null,
  onShowIdeOnboarding: () => void,
  onInstallationComplete: (
    status: IDEExtensionInstallationStatus | null,
  ) => void,
): Promise<void> {
  // Don't await so we don't block startup, but return a promise that resolves with the status
  void findAvailableIDE().then(onIdeDetected)

  const shouldAutoInstall = getGlobalConfig().autoInstallIdeExtension ?? true
  if (
    !isEnvTruthy(process.env.CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL) &&
    shouldAutoInstall
  ) {
    const ideType = ideToInstallExtension ?? getTerminalIdeType()
    if (ideType) {
      if (isVSCodeIde(ideType)) {
        void isIDEExtensionInstalled(ideType).then(async isAlreadyInstalled => {
          void maybeInstallIDEExtension(ideType)
            .catch(error => {
              const ideInstallationStatus: IDEExtensionInstallationStatus = {
                installed: false,
                error: error.message || 'Installation failed',
                installedVersion: null,
                ideType: ideType,
              }
              return ideInstallationStatus
            })
            .then(status => {
              onInstallationComplete(status)

              if (status?.installed) {
                // If we installed and don't yet have an IDE, search again.
                void findAvailableIDE().then(onIdeDetected)
              }

              if (
                !isAlreadyInstalled &&
                status?.installed === true &&
                !ideOnboardingDialog().hasIdeOnboardingDialogBeenShown()
              ) {
                onShowIdeOnboarding()
              }
            })
        })
      } else if (isJetBrainsIde(ideType)) {
        // Always check installation to populate the sync cache used by status notices
        void isIDEExtensionInstalled(ideType).then(async installed => {
          if (
            installed &&
            !ideOnboardingDialog().hasIdeOnboardingDialogBeenShown()
          ) {
            onShowIdeOnboarding()
          }
        })
      }
    }
  }
}
// initializeIdeIntegration 的编排顺序有讲究：先**不 await** 启动 findAvailableIDE（不阻塞启动），再并行考虑装扩展。装成功且此前没装过、且引导弹窗没弹过，才弹引导。JetBrains 分支只探测不安装，但探测本身也必须跑——它填充的是状态通知要用的同步缓存。

/**
 * Detects the host IP to use to connect to the extension.
 */
const detectHostIP = memoize(
  async (isIdeRunningInWindows: boolean, port: number) => {
    if (process.env.CLAUDE_CODE_IDE_HOST_OVERRIDE) {
      return process.env.CLAUDE_CODE_IDE_HOST_OVERRIDE
    }

    if (getPlatform() !== 'wsl' || !isIdeRunningInWindows) {
      return '127.0.0.1'
    }

    // If we are running under the WSL2 VM but the extension/plugin is running in
    // Windows, then we must use a different IP address to connect to the extension.
    // https://learn.microsoft.com/en-us/windows/wsl/networking
    try {
      const routeResult = await execa('ip route show | grep -i default', {
        shell: true,
        reject: false,
      })
      if (routeResult.exitCode === 0 && routeResult.stdout) {
        const gatewayMatch = routeResult.stdout.match(
          /default via (\d+\.\d+\.\d+\.\d+)/,
        )
        if (gatewayMatch) {
          const gatewayIP = gatewayMatch[1]!
          if (await checkIdeConnection(gatewayIP, port)) {
            return gatewayIP
          }
        }
      }
    } catch (_) {
      // Suppress any errors
    }

    // Fallback to the default if we cannot find anything
    return '127.0.0.1'
  },
  (isIdeRunningInWindows, port) => `${isIdeRunningInWindows}:${port}`,
)
// detectHostIP 解决 WSL2 的反向连接问题：CLI 在 WSL 虚拟机里、扩展在 Windows 宿主上，127.0.0.1 指向的是虚拟机自己。解法是读默认网关（ip route show 的 default via），并用一次 TCP 探活确认网关确实能连到那个端口，连不上再回落 127.0.0.1。memoize 的键刻意用 runningInWindows:port 组合——同一端口在不同宿主环境下解析结果不同。CLAUDE_CODE_IDE_HOST_OVERRIDE 是手工逃生门。

async function installFromArtifactory(command: string): Promise<string> {
  // Read auth token from ~/.npmrc
  const npmrcPath = join(os.homedir(), '.npmrc')
  let authToken: string | null = null
  const fs = getFsImplementation()

  try {
    const npmrcContent = await fs.readFile(npmrcPath, {
      encoding: 'utf8',
    })
    const lines = npmrcContent.split('\n')
    for (const line of lines) {
      // Look for the artifactory auth token line
      const match = line.match(
        /\/\/artifactory\.infra\.ant\.dev\/artifactory\/api\/npm\/npm-all\/:_authToken=(.+)/,
      )
      if (match && match[1]) {
        authToken = match[1].trim()
        break
      }
    }
  } catch (error) {
    logError(error as Error)
    throw new Error(`Failed to read npm authentication: ${error}`)
  }

  if (!authToken) {
    throw new Error('No artifactory auth token found in ~/.npmrc')
  }

  // Fetch the version from artifactory
  const versionUrl =
    'https://artifactory.infra.ant.dev/artifactory/armorcode-claude-code-internal/claude-vscode-releases/stable'

  try {
    const versionResponse = await axios.get(versionUrl, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })

    const version = versionResponse.data.trim()
    if (!version) {
      throw new Error('No version found in artifactory response')
    }

    // Download the .vsix file from artifactory
    const vsixUrl = `https://artifactory.infra.ant.dev/artifactory/armorcode-claude-code-internal/claude-vscode-releases/${version}/claude-code.vsix`
    const tempVsixPath = join(
      os.tmpdir(),
      `claude-code-${version}-${Date.now()}.vsix`,
    )

    try {
      const vsixResponse = await axios.get(vsixUrl, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        responseType: 'stream',
      })

      // Write the downloaded file to disk
      const writeStream = getFsImplementation().createWriteStream(tempVsixPath)
      await new Promise<void>((resolve, reject) => {
        vsixResponse.data.pipe(writeStream)
        writeStream.on('finish', resolve)
        writeStream.on('error', reject)
      })

      // Install the .vsix file
      // Add delay to prevent code command crashes
      await sleep(500)

      const result = await execFileNoThrowWithCwd(
        command,
        ['--force', '--install-extension', tempVsixPath],
        {
          env: getInstallationEnv(),
        },
      )

      if (result.code !== 0) {
        throw new Error(`${result.code}: ${result.error} ${result.stderr}`)
      }

      return version
    } finally {
      // Clean up the temporary file
      try {
        await fs.unlink(tempVsixPath)
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to fetch extension version from artifactory: ${error.message}`,
      )
    }
    throw error
  }
}
// installFromArtifactory 是内部构建（USER_TYPE=ant）的专线：从 ~/.npmrc 抠 artifactory 的 _authToken，先用它取 stable 版本号，再下载对应 .vsix 到临时目录，最后以 --force 装本地文件。三处工程细节：① 临时文件名带时间戳，多进程并发不会互相覆盖；② 装完在 finally 里删临时文件，失败也删；③ 每步错误都包成带上下文的 message（读凭据失败 / 取版本失败 / 安装非零退出），否则内部用户报障时只能看到 axios 的裸错误。
