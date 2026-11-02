// 跨平台系统目录（桌面、文档、下载等）的解析工具；它把 Windows、macOS、Linux 与 WSL 的差异统一成同一套路径，并允许测试时通过参数覆盖环境、家目录与平台。
import { homedir } from 'os'
import { join } from 'path'
import { logForDebugging } from './debug.js'
import { getPlatform, type Platform } from './platform.js'

// `SystemDirectories` 是带索引签名的类型，除固定字段外兼容任意字符串键，能与 `Record<string, string>` 直接互用。
export type SystemDirectories = {
  HOME: string
  DESKTOP: string
  DOCUMENTS: string
  DOWNLOADS: string
  [key: string]: string // Index signature for compatibility with Record<string, string>
}

type EnvLike = Record<string, string | undefined>

type SystemDirectoriesOptions = {
  env?: EnvLike
  homedir?: string
  platform?: Platform
}

/**
 * Get cross-platform system directories
 * Handles differences between Windows, macOS, Linux, and WSL
 * @param options Optional overrides for testing (env, homedir, platform)
 */
// `getSystemDirectories` 按平台分支返回目录：默认用家目录拼出三件套，Windows 改读 `USERPROFILE`，Linux/WSL 优先取 XDG 基目录规范里的变量。
export function getSystemDirectories(
  options?: SystemDirectoriesOptions,
): SystemDirectories {
  const platform = options?.platform ?? getPlatform()
  const homeDir = options?.homedir ?? homedir()
  const env = options?.env ?? process.env

  // Default paths used by most platforms
  const defaults: SystemDirectories = {
// `defaults` 是大多数平台共用的基础路径，Mac 与未知平台直接返回它，Windows 与 Linux 在其上做覆盖。
    HOME: homeDir,
    DESKTOP: join(homeDir, 'Desktop'),
    DOCUMENTS: join(homeDir, 'Documents'),
    DOWNLOADS: join(homeDir, 'Downloads'),
  }

// `switch (platform)` 把四套平台的差异集中在此；未知平台回落到默认路径并打日志提示。
  switch (platform) {
    case 'windows': {
      // Windows: Use USERPROFILE if available (handles localized folder names)
      const userProfile = env.USERPROFILE || homeDir
      return {
        HOME: homeDir,
        DESKTOP: join(userProfile, 'Desktop'),
        DOCUMENTS: join(userProfile, 'Documents'),
        DOWNLOADS: join(userProfile, 'Downloads'),
      }
    }

    case 'linux':
    case 'wsl': {
      // Linux/WSL: Check XDG Base Directory specification first
      return {
        HOME: homeDir,
        DESKTOP: env.XDG_DESKTOP_DIR || defaults.DESKTOP,
        DOCUMENTS: env.XDG_DOCUMENTS_DIR || defaults.DOCUMENTS,
        DOWNLOADS: env.XDG_DOWNLOAD_DIR || defaults.DOWNLOADS,
      }
    }

// macOS 与未知平台分支直接返回默认路径；若平台识别为未知，仅记一条调试日志而不改变行为。
    case 'macos':
    default: {
      // macOS and unknown platforms use standard paths
      if (platform === 'unknown') {
        logForDebugging(`Unknown platform detected, using default paths`)
      }
      return defaults
    }
  }
}
