import { logForDebugging } from './debug.js'
import { which } from './which.js'

// Session cache to avoid repeated checks
const binaryCache = new Map<string, boolean>()
// 会话级缓存，键是去掉首尾空白的命令名。同一进程内重复探测同一个二进制只走一次 which，避免频繁派生子进程。

/**
 * Check if a binary/command is installed and available on the system.
 * Uses 'which' on Unix systems (macOS, Linux, WSL) and 'where' on Windows.
 *
 * @param command - The command name to check (e.g., 'gopls', 'rust-analyzer')
 * @returns Promise<boolean> - true if the command exists, false otherwise
 */
export async function isBinaryInstalled(command: string): Promise<boolean> {
// 探测入口：Unix 系走 which，Windows 走 where，差异由 which 模块内部吸收，这里只关心有没有。
  // Edge case: empty or whitespace-only command
  if (!command || !command.trim()) {
    logForDebugging('[binaryCheck] Empty command provided, returning false')
    return false
  }
// 空串和纯空白直接判否，且先于缓存查询——否则空串会被缓存成一个条目，白白占位。

  // Trim the command to handle whitespace
  const trimmedCommand = command.trim()

  // Check cache first
  const cached = binaryCache.get(trimmedCommand)
  if (cached !== undefined) {
    logForDebugging(
      `[binaryCheck] Cache hit for '${trimmedCommand}': ${cached}`,
    )
    return cached
  }
// 缓存命中时打日志再返回。注意判的是 `!== undefined` 而非真值判断，否则缓存了 false 会被当作未命中，反复探测。

  let exists = false
  if (await which(trimmedCommand).catch(() => null)) {
    exists = true
  }
// which 抛错一律当「未安装」处理：探测失败和确实没有，对调用方的决策是等价的，不该让异常冒出去。

  // Cache the result
  binaryCache.set(trimmedCommand, exists)

  logForDebugging(
    `[binaryCheck] Binary '${trimmedCommand}' ${exists ? 'found' : 'not found'}`,
  )

  return exists
}
// 否结果同样写缓存。这里缓存的是「这次探测的结论」，不是「二进制存在」——环境变量在进程生命周期内基本不变，可以这么省。

/**
 * Clear the binary check cache (useful for testing)
 */
export function clearBinaryCache(): void {
  binaryCache.clear()
}
// 提供清缓存入口给测试用，避免用例之间互相污染结论。生产代码不应调用。
