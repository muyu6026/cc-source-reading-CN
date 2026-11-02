/**
 * Utility for checking git availability.
 *
 * Git is required for installing GitHub-based marketplaces. This module
 * provides a memoized check to determine if git is available on the system.
 */
// Git 可用性探测模块：git 是安装 GitHub 系市场的先决条件，本模块提供带记忆化的检查，判断系统里能否找到 git。

import memoize from 'lodash-es/memoize.js'
import { which } from '../which.js'

/**
 * Check if a command is available in PATH.
 *
 * Uses which to find the actual executable without executing it.
 * This is a security best practice to avoid executing arbitrary code
 * in untrusted directories.
 *
 * @param command - The command to check for
 * @returns True if the command exists and is executable
 */
// 命令可用性检查文档：用 which 找到真实可执行文件而不执行它，是不执行任意代码的安全实践，避免在不受信任目录里跑命令。
// 内部函数：用 which 查命令是否存在，任何异常都视作不可用，返回布尔。
async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    return !!(await which(command))
  } catch {
    return false
  }
}

/**
 * Check if git is available on the system.
 *
 * This is memoized so repeated calls within a session return the cached result.
 * Git availability is unlikely to change during a single CLI session.
 *
 * Only checks PATH — does not exec git. On macOS this means the /usr/bin/git
 * xcrun shim passes even without Xcode CLT installed; callers that hit
 * `xcrun: error:` at exec time should call markGitUnavailable() so the rest
 * of the session behaves as though git is absent.
 *
 * @returns True if git is installed and executable
 */
// git 可用性检查文档：用 memoize 记忆化，单次会话内重复调用直接返回缓存；只查 PATH 不真正执行 git。macOS 上 /usr/bin/git 的 xcrun 垫片即使没装 Xcode CLT 也会通过，若执行时真撞上 xcrun 报错应调 markGitUnavailable()。
// 对外的记忆化检查：首次调用实际跑 which git，之后整个会话走缓存。
export const checkGitAvailable = memoize(async (): Promise<boolean> => {
  return isCommandAvailable('git')
})

/**
 * Force the memoized git-availability check to return false for the rest of
 * the session.
 *
 * Call this when a git invocation fails in a way that indicates the binary
 * exists on PATH but cannot actually run — the macOS xcrun shim being the
 * main case (`xcrun: error: invalid active developer path`). Subsequent
 * checkGitAvailable() calls then short-circuit to false, so downstream code
 * that guards on git availability skips cleanly instead of failing repeatedly
 * with the same exec error.
 *
 * lodash memoize uses a no-arg cache key of undefined.
 */
// 强制让本会话余下时间都返回 false：当 git 存在于 PATH 却跑不起来（典型是 macOS xcrun 垫片）时调用，使下游按 git 缺失干净跳过，而不是反复撞同一执行错误。
export function markGitUnavailable(): void {
  checkGitAvailable.cache?.set?.(undefined, Promise.resolve(false))
}

/**
 * Clear the git availability cache.
 * Used for testing purposes.
 */
// 清空可用性缓存，主要给测试用。
export function clearGitAvailabilityCache(): void {
  checkGitAvailable.cache?.clear?.()
}
// 模块收尾：三个导出（检查 / 强制不可用 / 清缓存）配合 lodash memoize 的缓存键 undefined，实现会话级一次性探测与可测试复位。
