/**
 * Utilities for handling local installation
 */

import { access, chmod, writeFile } from 'fs/promises'
import { join } from 'path'
import { type ReleaseChannel, saveGlobalConfig } from './config.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { getErrnoCode } from './errors.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'
// 本地安装器：把 Claude CLI 装进用户目录的受管 local 环境，独立 node_modules 与 wrapper 脚本，避免污染全局。
import { jsonStringify } from './slowOperations.js'

// Lazy getters: getClaudeConfigHomeDir() is memoized and reads process.env.
// Evaluating at module scope would capture the value before entrypoints like
// hfi.tsx get a chance to set CLAUDE_CONFIG_DIR in main(), and would also
// populate the memoize cache with that stale value for all 150+ other callers.
function getLocalInstallDir(): string {
  return join(getClaudeConfigHomeDir(), 'local')
}
export function getLocalClaudePath(): string {
  return join(getLocalInstallDir(), 'claude')
}
// getLocalClaudePath 返回受管安装目录下的 claude 可执行入口路径。

/**
 * Check if we're running from our managed local installation
 */
export function isRunningFromLocalInstallation(): boolean {
  const execPath = process.argv[1] || ''
  return execPath.includes('/.claude/local/node_modules/')
}
// isRunningFromLocalInstallation 通过 argv[1] 是否含 /.claude/local/node_modules/ 判断当前是否正处于受管本地安装里运行。

/**
 * Write `content` to `path` only if the file does not already exist.
 * Uses O_EXCL ('wx') for atomic create-if-missing.
 */
async function writeIfMissing(
  path: string,
  content: string,
  mode?: number,
): Promise<boolean> {
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode })
    return true
  } catch (e) {
    if (getErrnoCode(e) === 'EEXIST') return false
    throw e
  }
}
// writeIfMissing 用 O_EXCL 原子地「不存在才写入」，已存在则静默返回 false，避免覆盖用户已改的配置。

/**
 * Ensure the local package environment is set up
 * Creates the directory, package.json, and wrapper script
 */
export async function ensureLocalPackageEnvironment(): Promise<boolean> {
  try {
    const localInstallDir = getLocalInstallDir()

    // Create installation directory (recursive, idempotent)
    await getFsImplementation().mkdir(localInstallDir)

    // Create package.json if it doesn't exist
    await writeIfMissing(
      join(localInstallDir, 'package.json'),
      jsonStringify(
        { name: 'claude-local', version: '0.0.1', private: true },
        null,
        2,
      ),
    )

    // Create the wrapper script if it doesn't exist
    const wrapperPath = join(localInstallDir, 'claude')
    const created = await writeIfMissing(
      wrapperPath,
      `#!/bin/sh\nexec "${localInstallDir}/node_modules/.bin/claude" "$@"`,
      0o755,
    )
    if (created) {
      // Mode in writeFile is masked by umask; chmod to ensure executable bit.
      await chmod(wrapperPath, 0o755)
    }

    return true
  } catch (error) {
    logError(error)
    return false
  }
}
// ensureLocalPackageEnvironment 幂等地建目录、写 package.json、写可执行 wrapper 脚本（模式位被 umask 屏蔽，故再 chmod 一次确保执行位）。

/**
 * Install or update Claude CLI package in the local directory
 * @param channel - Release channel to use (latest or stable)
 * @param specificVersion - Optional specific version to install (overrides channel)
 */
export async function installOrUpdateClaudePackage(
  channel: ReleaseChannel,
  specificVersion?: string | null,
): Promise<'in_progress' | 'success' | 'install_failed'> {
  try {
    // First ensure the environment is set up
    if (!(await ensureLocalPackageEnvironment())) {
      return 'install_failed'
    }

    // Use specific version if provided, otherwise use channel tag
    const versionSpec = specificVersion
      ? specificVersion
      : channel === 'stable'
        ? 'stable'
        : 'latest'
    const result = await execFileNoThrowWithCwd(
      'npm',
      ['install', `${MACRO.PACKAGE_URL}@${versionSpec}`],
      { cwd: getLocalInstallDir(), maxBuffer: 1000000 },
    )

    if (result.code !== 0) {
      const error = new Error(
        `Failed to install Claude CLI package: ${result.stderr}`,
      )
      logError(error)
      return result.code === 190 ? 'in_progress' : 'install_failed'
    }

    // Set installMethod to 'local' to prevent npm permission warnings
    saveGlobalConfig(current => ({
      ...current,
      installMethod: 'local',
    }))

    return 'success'
  } catch (error) {
    logError(error)
    return 'install_failed'
  }
}
// installOrUpdateClaudePackage 调用 npm 安装指定版本或通道；失败码 190 表示安装进行中，其余返回 install_failed，并把 installMethod 置为 local 免 npm 权限告警。

/**
 * Check if local installation exists.
 * Pure existence probe — callers use this to choose update path / UI hints.
 */
export async function localInstallationExists(): Promise<boolean> {
  try {
    await access(join(getLocalInstallDir(), 'node_modules', '.bin', 'claude'))
    return true
  } catch {
    return false
  }
}
// localInstallationExists 仅做存在性探测，调用方据此选择「更新」还是「UI 提示」。

/**
 * Get shell type to determine appropriate path setup
 */
export function getShellType(): string {
  const shellPath = process.env.SHELL || ''
  if (shellPath.includes('zsh')) return 'zsh'
  if (shellPath.includes('bash')) return 'bash'
  if (shellPath.includes('fish')) return 'fish'
  return 'unknown'
}
// getShellType 按 SHELL 环境变量推断用户 shell 类型（zsh/bash/fish），用于决定 PATH 拼接方式。
