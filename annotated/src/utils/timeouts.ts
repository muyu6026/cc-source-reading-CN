// Constants for timeout values
// 模块总述：bash 操作的超时取值工具，提供默认与最大两个档位，均可被对应环境变量覆盖。
const DEFAULT_TIMEOUT_MS = 120_000 // 2 minutes
// 两个基础常量：默认 2 分钟、最大 10 分钟，作为环境未配置时的回退值。
const MAX_TIMEOUT_MS = 600_000 // 10 minutes

type EnvLike = Record<string, string | undefined>

/**
 * Get the default timeout for bash operations in milliseconds
 * Checks BASH_DEFAULT_TIMEOUT_MS environment variable or returns 2 minutes default
 * @param env Environment variables to check (defaults to process.env for production use)
 */
// getDefaultBashTimeoutMs：读取 `BASH_DEFAULT_TIMEOUT_MS`，解析为非正数或非法时回退到 2 分钟默认。
export function getDefaultBashTimeoutMs(env: EnvLike = process.env): number {
  const envValue = env.BASH_DEFAULT_TIMEOUT_MS
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_TIMEOUT_MS
}

/**
 * Get the maximum timeout for bash operations in milliseconds
 * Checks BASH_MAX_TIMEOUT_MS environment variable or returns 10 minutes default
 * @param env Environment variables to check (defaults to process.env for production use)
 */
// getMaxBashTimeoutMs：读取 `BASH_MAX_TIMEOUT_MS`，解析有效时取其与默认的大者，否则用 10 分钟与默认的大者，保证最大值不低于默认。
export function getMaxBashTimeoutMs(env: EnvLike = process.env): number {
  const envValue = env.BASH_MAX_TIMEOUT_MS
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      // Ensure max is at least as large as default
      return Math.max(parsed, getDefaultBashTimeoutMs(env))
    }
  }
  // Always ensure max is at least as large as default
  return Math.max(MAX_TIMEOUT_MS, getDefaultBashTimeoutMs(env))
// 兜底返回：无论环境变量是否配置，最终都取 MAX 与默认超时的大者，确保最大档始终不小于默认档。
}
