/**
 * Path conversion utilities for IDE communication
 * Handles conversions between Claude's environment and the IDE's environment
 */
// IDE 与 Claude 两套环境的路径换算：典型场景是 Windows 侧的 IDE 配 WSL 里的 Claude，双方对同一个文件的写法完全不同。

import { execFileSync } from 'child_process'
// 直接起 wslpath 子进程换算：WSL 自带此工具，比手写规则覆盖面广（网络路径、映射盘等），失败再退回手写。

export interface IDEPathConverter {
  /**
   * Convert path from IDE format to Claude's local format
   * Used when reading workspace folders from IDE lockfile
   */
  toLocalPath(idePath: string): string

  /**
   * Convert path from Claude's local format to IDE format
   * Used when sending paths to IDE (showDiffInIDE, etc.)
   */
  toIDEPath(localPath: string): string
}
// 接口只有两个方向：toLocalPath 进（读 IDE 锁文件里的工作区）、toIDEPath 出（把路径发回 IDE 打差异视图）。

/**
 * Converter for Windows IDE + WSL Claude scenario
 */
export class WindowsToWSLConverter implements IDEPathConverter {
  constructor(private wslDistroName: string | undefined) {}
// 构造器只存发行版名：WSL 允许多发行版并存，UNC 路径里嵌着发行版名，跨发行版的路径 wslpath 换算不了。

  toLocalPath(windowsPath: string): string {
    if (!windowsPath) return windowsPath

    // Check if this is a path from a different WSL distro
    if (this.wslDistroName) {
      const wslUncMatch = windowsPath.match(
        /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(.*)$/,
      )
      if (wslUncMatch && wslUncMatch[1] !== this.wslDistroName) {
        // Different distro - wslpath will fail, so return original path
        return windowsPath
      }
    }
// 跨发行版直接原样返回：wslpath 对别的发行版的 UNC 路径会失败，与其吃一次异常不如先判后行。

    try {
      // Use wslpath to convert Windows paths to WSL paths
      const result = execFileSync('wslpath', ['-u', windowsPath], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'], // wslpath writes "wslpath: <errortext>" to stderr
      }).trim()

      return result
    } catch {
      // If wslpath fails, fall back to manual conversion
      return windowsPath
        .replace(/\\/g, '/') // Convert backslashes to forward slashes
        .replace(/^([A-Z]):/i, (_, letter) => `/mnt/${letter.toLowerCase()}`)
    }
  }
// 转换失败的兜底是手写规则：反斜杠换正斜杠、盘符换成 /mnt 小写挂载点。粗但够用，wslpath 不可用时（如发行版未装）不至于完全失效。

  toIDEPath(wslPath: string): string {
    if (!wslPath) return wslPath

    try {
      // Use wslpath to convert WSL paths to Windows paths
      const result = execFileSync('wslpath', ['-w', wslPath], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'], // wslpath writes "wslpath: <errortext>" to stderr
      }).trim()

      return result
    } catch {
      // If wslpath fails, return the original path
      return wslPath
    }
  }
}
// 反方向不做手写兜底：WSL 到 Windows 的路径只有一个消费者（IDE 显示），换不出来就发原样，IDE 侧自己会报。

/**
 * Check if distro names match for WSL UNC paths
 */
export function checkWSLDistroMatch(
  windowsPath: string,
  wslDistroName: string,
): boolean {
  const wslUncMatch = windowsPath.match(
    /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(.*)$/,
  )
  if (wslUncMatch) {
    return wslUncMatch[1] === wslDistroName
  }
  return true // Not a WSL UNC path, so no distro mismatch
}
// checkWSLDistroMatch 是给外面复用的判定：不是 WSL UNC 路径视为匹配（返回 true），是的话才比发行版名。
