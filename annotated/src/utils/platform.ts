import { readdir, readFile } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { release as osRelease } from 'os'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'

// 本模块负责平台与环境探测：解析当前操作系统、WSL 版本、Linux 发行版信息，并识别代码仓库所用的版本控制系统。
export type Platform = 'macos' | 'windows' | 'wsl' | 'linux' | 'unknown'
// Platform 类型：macos / windows / wsl / linux / unknown 五值联合。

export const SUPPORTED_PLATFORMS: Platform[] = ['macos', 'wsl']
// SUPPORTED_PLATFORMS：Claude Desktop 集成仅支持 macOS 与 WSL 两类平台。

export const getPlatform = memoize((): Platform => {
  try {
    if (process.platform === 'darwin') {
      return 'macos'
    }

    if (process.platform === 'win32') {
      return 'windows'
    }

    if (process.platform === 'linux') {
      // Check if running in WSL (Windows Subsystem for Linux)
      try {
        const procVersion = getFsImplementation().readFileSync(
          '/proc/version',
          { encoding: 'utf8' },
        )
        if (
          procVersion.toLowerCase().includes('microsoft') ||
          procVersion.toLowerCase().includes('wsl')
        ) {
          return 'wsl'
        }
      } catch (error) {
        // Error reading /proc/version, assume regular Linux
        logError(error)
      }

      // Regular Linux
      return 'linux'
    }

    // Unknown platform
    return 'unknown'
  } catch (error) {
    logError(error)
    return 'unknown'
  }
})
// getPlatform：记忆化探测平台；Linux 下读取 /proc/version 判断是否 WSL，任何异常都退回 unknown。

export const getWslVersion = memoize((): string | undefined => {
  // Only check for WSL on Linux systems
  if (process.platform !== 'linux') {
    return undefined
  }
  try {
    const procVersion = getFsImplementation().readFileSync('/proc/version', {
      encoding: 'utf8',
    })

    // First check for explicit WSL version markers (e.g., "WSL2", "WSL3", etc.)
    const wslVersionMatch = procVersion.match(/WSL(\d+)/i)
    if (wslVersionMatch && wslVersionMatch[1]) {
      return wslVersionMatch[1]
    }

    // If no explicit WSL version but contains Microsoft, assume WSL1
    // This handles the original WSL1 format: "4.4.0-19041-Microsoft"
    if (procVersion.toLowerCase().includes('microsoft')) {
      return '1'
    }

    // Not WSL or unable to determine version
    return undefined
  } catch (error) {
    logError(error)
    return undefined
  }
})
// getWslVersion：从 /proc/version 提取 WSL 版本号，无显式标记时按含 Microsoft 字样退回 WSL1。

export type LinuxDistroInfo = {
  linuxDistroId?: string
  linuxDistroVersion?: string
  linuxKernel?: string
}

export const getLinuxDistroInfo = memoize(
  async (): Promise<LinuxDistroInfo | undefined> => {
    if (process.platform !== 'linux') {
      return undefined
    }

    const result: LinuxDistroInfo = {
      linuxKernel: osRelease(),
    }

    try {
      const content = await readFile('/etc/os-release', 'utf8')
      for (const line of content.split('\n')) {
        const match = line.match(/^(ID|VERSION_ID)=(.*)$/)
        if (match && match[1] && match[2]) {
          const value = match[2].replace(/^"|"$/g, '')
          if (match[1] === 'ID') {
            result.linuxDistroId = value
          } else {
            result.linuxDistroVersion = value
          }
        }
      }
    } catch {
      // /etc/os-release may not exist on all Linux systems
    }

    return result
  },
)
// getLinuxDistroInfo：读取 /etc/os-release 解析发行版 ID 与版本，并附带内核版本。

const VCS_MARKERS: Array<[string, string]> = [
  ['.git', 'git'],
  ['.hg', 'mercurial'],
  ['.svn', 'svn'],
  ['.p4config', 'perforce'],
  ['$tf', 'tfs'],
  ['.tfvc', 'tfs'],
  ['.jj', 'jujutsu'],
  ['.sl', 'sapling'],
]
// VCS_MARKERS：常见版本控制系统的目录/文件标记表（git、hg、svn、perforce、tfs、jj、sl 等）。

export async function detectVcs(dir?: string): Promise<string[]> {
  const detected = new Set<string>()

  // Check for Perforce via env var
  if (process.env.P4PORT) {
    detected.add('perforce')
  }

  try {
    const targetDir = dir ?? getFsImplementation().cwd()
    const entries = new Set(await readdir(targetDir))
    for (const [marker, vcs] of VCS_MARKERS) {
      if (entries.has(marker)) {
        detected.add(vcs)
      }
    }
  } catch {
    // Directory may not be readable
  }

  return [...detected]
}
// detectVcs：综合环境变量与目录标记，返回当前路径检测到的版本控制系统列表。
