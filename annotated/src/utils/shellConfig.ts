/**
 * Utilities for managing shell configuration files (like .bashrc, .zshrc)
 * Used for managing claude aliases and PATH entries
 */

import { open, readFile, stat } from 'fs/promises'
import { homedir as osHomedir } from 'os'
import { join } from 'path'
import { isFsInaccessible } from './errors.js'
import { getLocalClaudePath } from './localInstaller.js'
// 文件入口：shell 配置文件（.bashrc / .zshrc 等）读写工具，核心是 claude 别名的安装与查找。

export const CLAUDE_ALIAS_REGEX = /^\s*alias\s+claude\s*=/
// CLAUDE_ALIAS_REGEX：识别以 alias claude= 开头的配置行。

type EnvLike = Record<string, string | undefined>

type ShellConfigOptions = {
  env?: EnvLike
  homedir?: string
}
// ShellConfigOptions：允许测试注入 env 与 homedir 覆盖。

/**
 * Get the paths to shell configuration files
 * Respects ZDOTDIR for zsh users
 * @param options Optional overrides for testing (env, homedir)
 */
export function getShellConfigPaths(
  options?: ShellConfigOptions,
): Record<string, string> {
  const home = options?.homedir ?? osHomedir()
  const env = options?.env ?? process.env
  const zshConfigDir = env.ZDOTDIR || home
// getShellConfigPaths：按平台返回各 shell 的 rc 路径，zsh 尊重 ZDOTDIR 环境变量。
  return {
    zsh: join(zshConfigDir, '.zshrc'),
    bash: join(home, '.bashrc'),
    fish: join(home, '.config/fish/config.fish'),
  }
}

/**
 * Filter out installer-created claude aliases from an array of lines
 * Only removes aliases pointing to $HOME/.claude/local/claude
 * Preserves custom user aliases that point to other locations
 * Returns the filtered lines and whether our default installer alias was found
 */
export function filterClaudeAliases(lines: string[]): {
  filtered: string[]
  hadAlias: boolean
} {
  let hadAlias = false
  const filtered = lines.filter(line => {
    // Check if this is a claude alias
    if (CLAUDE_ALIAS_REGEX.test(line)) {
      // Extract the alias target - handle spaces, quotes, and various formats
      // First try with quotes
      let match = line.match(/alias\s+claude\s*=\s*["']([^"']+)["']/)
      if (!match) {
        // Try without quotes (capturing until end of line or comment)
        match = line.match(/alias\s+claude\s*=\s*([^#\n]+)/)
      }

      if (match && match[1]) {
        const target = match[1].trim()
        // Only remove if it points to the installer location
        // The installer always creates aliases with the full expanded path
        if (target === getLocalClaudePath()) {
          hadAlias = true
          return false // Remove this line
        }
      }
      // Keep custom aliases that don't point to the installer location
    }
    return true
  })
  return { filtered, hadAlias }
// filterClaudeAliases：仅剔除安装器写入的 claude 别名，保留用户自定义别名。
}

/**
 * Read a file and split it into lines
 * Returns null if file doesn't exist or can't be read
 */
export async function readFileLines(
  filePath: string,
): Promise<string[] | null> {
  try {
    const content = await readFile(filePath, { encoding: 'utf8' })
    return content.split('\n')
  } catch (e: unknown) {
    if (isFsInaccessible(e)) return null
    throw e
  }
}
// readFileLines：读取并按行拆分，文件系统不可访问时安全返回 null。

/**
 * Write lines back to a file
 */
export async function writeFileLines(
  filePath: string,
  lines: string[],
): Promise<void> {
  const fh = await open(filePath, 'w')
  try {
    await fh.writeFile(lines.join('\n'), { encoding: 'utf8' })
    await fh.datasync()
  } finally {
    await fh.close()
  }
}
// writeFileLines：打开文件、写入、datasync 强制落盘后关闭。

/**
 * Check if a claude alias exists in any shell config file
 * Returns the alias target if found, null otherwise
 * @param options Optional overrides for testing (env, homedir)
 */
export async function findClaudeAlias(
  options?: ShellConfigOptions,
): Promise<string | null> {
  const configs = getShellConfigPaths(options)

  for (const configPath of Object.values(configs)) {
    const lines = await readFileLines(configPath)
    if (!lines) continue

    for (const line of lines) {
      if (CLAUDE_ALIAS_REGEX.test(line)) {
        // Extract the alias target
        const match = line.match(/alias\s+claude=["']?([^"'\s]+)/)
        if (match && match[1]) {
          return match[1]
        }
      }
    }
  }

  return null
// findClaudeAlias：遍历各 shell 配置，返回首个 claude 别名目标。
}
// findClaudeAlias 收尾：无匹配则返回 null。

/**
 * Check if a claude alias exists and points to a valid executable
 * Returns the alias target if valid, null otherwise
 * @param options Optional overrides for testing (env, homedir)
 */
export async function findValidClaudeAlias(
  options?: ShellConfigOptions,
): Promise<string | null> {
  const aliasTarget = await findClaudeAlias(options)
  if (!aliasTarget) return null

  const home = options?.homedir ?? osHomedir()

  // Expand ~ to home directory
  const expandedPath = aliasTarget.startsWith('~')
    ? aliasTarget.replace('~', home)
    : aliasTarget

  // Check if the target exists and is executable
  try {
    const stats = await stat(expandedPath)
    // Check if it's a file (could be executable or symlink)
    if (stats.isFile() || stats.isSymbolicLink()) {
      return aliasTarget
    }
  } catch {
    // Target doesn't exist or can't be accessed
  }

  return null
}
// findValidClaudeAlias：在 findClaudeAlias 基础上校验目标是否真实存在且可执行。
