/**
 * XDG Base Directory utilities for Claude CLI Native Installer
 *
 * Implements the XDG Base Directory specification for organizing
 * native installer components across appropriate system directories.
 *
 * @see https://specifications.freedesktop.org/basedir-spec/latest/
 */
// 本文件实现 XDG 基础目录规范，供 Claude CLI 原生安装器把组件放到合适的系统目录（状态/缓存/数据/用户 bin）。

import { homedir as osHomedir } from 'os'
import { join } from 'path'

type EnvLike = Record<string, string | undefined>

type XDGOptions = {
  env?: EnvLike
  homedir?: string
}

function resolveOptions(options?: XDGOptions): { env: EnvLike; home: string } {
// `resolveOptions` 统一解析可选参数：允许测试时注入 `env` 与 `homedir`，缺省回落到 `process.env` 与实际家目录。
  return {
    env: options?.env ?? process.env,
    home: options?.homedir ?? process.env.HOME ?? osHomedir(),
  }
}

/**
 * Get XDG state home directory
 * Default: ~/.local/state
 * @param options Optional env and homedir overrides for testing
 */
export function getXDGStateHome(options?: XDGOptions): string {
// `getXDGStateHome` 返回 XDG 状态目录，默认 `~/.local/state`，可用 `XDG_STATE_HOME` 覆盖。
  const { env, home } = resolveOptions(options)
  return env.XDG_STATE_HOME ?? join(home, '.local', 'state')
}

/**
 * Get XDG cache home directory
 * Default: ~/.cache
 * @param options Optional env and homedir overrides for testing
 */
export function getXDGCacheHome(options?: XDGOptions): string {
// `getXDGCacheHome` 返回 XDG 缓存目录，默认 `~/.cache`，可用 `XDG_CACHE_HOME` 覆盖。
  const { env, home } = resolveOptions(options)
  return env.XDG_CACHE_HOME ?? join(home, '.cache')
}

/**
 * Get XDG data home directory
 * Default: ~/.local/share
 * @param options Optional env and homedir overrides for testing
 */
export function getXDGDataHome(options?: XDGOptions): string {
// `getXDGDataHome` 返回 XDG 数据目录，默认 `~/.local/share`，可用 `XDG_DATA_HOME` 覆盖。
  const { env, home } = resolveOptions(options)
  return env.XDG_DATA_HOME ?? join(home, '.local', 'share')
}

/**
 * Get user bin directory (not technically XDG but follows the convention)
 * Default: ~/.local/bin
 * @param options Optional homedir override for testing
 */
export function getUserBinDir(options?: XDGOptions): string {
// `getUserBinDir` 返回用户 bin 目录 `~/.local/bin`（虽不是严格 XDG 但遵循同一约定），仅支持 `homedir` 覆盖。
  const { home } = resolveOptions(options)
  return join(home, '.local', 'bin')
}
