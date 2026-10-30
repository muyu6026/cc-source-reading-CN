import { getHistory } from '../../history.js'
import { logForDebugging } from '../debug.js'

/**
 * Result of shell history completion lookup
 */
// 文件级说明：依据历史命令做 shell 行内补全，返回幽灵文本所需的后缀（suffix）。
export type ShellHistoryMatch = {
  /** The full command from history */
  fullCommand: string
  /** The suffix to display as ghost text (the part after user's input) */
  suffix: string
}
// ShellHistoryMatch 类型：一条匹配包含完整命令与待显示后缀两段。

// Cache for shell history commands to avoid repeated async reads
// History only changes when user submits a command, so a long TTL is fine
let shellHistoryCache: string[] | null = null
let shellHistoryCacheTimestamp = 0
const CACHE_TTL_MS = 60000 // 60 seconds - history won't change while typing
// 缓存与 TTL：历史仅在用户提交命令时变化，故用 60 秒长 TTL 避免重复异步读取。

/**
 * Get shell commands from history, with caching
 */
async function getShellHistoryCommands(): Promise<string[]> {
  const now = Date.now()

  // Return cached result if still fresh
  if (shellHistoryCache && now - shellHistoryCacheTimestamp < CACHE_TTL_MS) {
    return shellHistoryCache
  }

  const commands: string[] = []
  const seen = new Set<string>()

  try {
    // Read history entries and filter for bash commands
    for await (const entry of getHistory()) {
      if (entry.display && entry.display.startsWith('!')) {
        // Remove the '!' prefix to get the actual command
        const command = entry.display.slice(1).trim()
        if (command && !seen.has(command)) {
          seen.add(command)
          commands.push(command)
        }
      }
      // Limit to 50 most recent unique commands
      if (commands.length >= 50) {
        break
      }
    }
  } catch (error) {
    logForDebugging(`Failed to read shell history: ${error}`)
  }

  shellHistoryCache = commands
  shellHistoryCacheTimestamp = now
  return commands
}
// getShellHistoryCommands 收尾：遍历历史、过滤以 ! 开头的 bash 命令、最多取 50 条去重。

/**
 * Clear the shell history cache (useful when history is updated)
 */
export function clearShellHistoryCache(): void {
  shellHistoryCache = null
  shellHistoryCacheTimestamp = 0
}
// clearShellHistoryCache 收尾：暴露给上层在用户提交命令后清空缓存。

/**
 * Add a command to the front of the shell history cache without
 * flushing the entire cache.  If the command already exists in the
 * cache it is moved to the front (deduped).  When the cache hasn't
 * been populated yet this is a no-op – the next lookup will read
 * the full history which already includes the new command.
 */
export function prependToShellHistoryCache(command: string): void {
  if (!shellHistoryCache) {
    return
  }
  const idx = shellHistoryCache.indexOf(command)
  if (idx !== -1) {
    shellHistoryCache.splice(idx, 1)
  }
  shellHistoryCache.unshift(command)
}
// prependToShellHistoryCache 收尾：新命令插到缓存头部并去重，未填充时为空操作。

/**
 * Find the best matching shell command from history for the given input
 *
 * @param input The current user input (without '!' prefix)
 * @returns The best match, or null if no match found
 */
// getShellHistoryCompletion 文档：块注释说明入参与返回。
export async function getShellHistoryCompletion(
  input: string,
): Promise<ShellHistoryMatch | null> {
  // Don't suggest for empty or very short input
  if (!input || input.length < 2) {
    return null
  }

  // Check the trimmed input to make sure there's actual content
  const trimmedInput = input.trim()
  if (!trimmedInput) {
    return null
  }

  const commands = await getShellHistoryCommands()

  // Find the first command that starts with the EXACT input (including spaces)
  // This ensures "ls " matches "ls -lah" but "ls  " (2 spaces) does not
  for (const command of commands) {
    if (command.startsWith(input) && command !== input) {
      return {
        fullCommand: command,
        suffix: command.slice(input.length),
      }
    }
  }

  return null
}
// getShellHistoryCompletion 收尾：按精确前缀（含空格）匹配历史命令，返回完整命令与补全后缀。
