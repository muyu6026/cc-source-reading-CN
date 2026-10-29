import { mkdirSync, writeFileSync } from 'fs'
import {
  getApiKeyFromFd,
  getOauthTokenFromFd,
  setApiKeyFromFd,
  setOauthTokenFromFd,
} from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { errorMessage, isENOENT } from './errors.js'
import { getFsImplementation } from './fsOperations.js'

/**
 * Well-known token file locations in CCR. The Go environment-manager creates
 * /home/claude/.claude/remote/ and will (eventually) write these files too.
 * Until then, this module writes them on successful FD read so subprocesses
 * spawned inside the CCR container can find the token without inheriting
 * the FD — which they can't: pipe FDs don't cross tmux/shell boundaries.
 */
// 文件总述：在 CCR（远程 Claude）容器里，把通过文件描述符传入的 OAuth token 与 API key 落地到已知位置，供子进程按路径读取；管道 FD 无法跨 exec/tmux 边界，所以需要落盘兜底。
const CCR_TOKEN_DIR = '/home/claude/.claude/remote'
export const CCR_OAUTH_TOKEN_PATH = `${CCR_TOKEN_DIR}/.oauth_token`
export const CCR_API_KEY_PATH = `${CCR_TOKEN_DIR}/.api_key`
export const CCR_SESSION_INGRESS_TOKEN_PATH = `${CCR_TOKEN_DIR}/.session_ingress_token`
// 三个已知位置的 token 文件路径常量：OAuth token、API key、session ingress token，统一放在 /home/claude/.claude/remote 下。

/**
 * Best-effort write of the token to a well-known location for subprocess
 * access. CCR-gated: outside CCR there's no /home/claude/ and no reason to
 * put a token on disk that the FD was meant to keep off disk.
 */
export function maybePersistTokenForSubprocesses(
  path: string,
  token: string,
  tokenName: string,
): void {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    return
  }
// 非 CCR 环境直接返回：没有 /home/claude 目录，也没有理由把本想用 FD 避开的 token 写到磁盘上。
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- one-shot startup write in CCR, caller is sync
    mkdirSync(CCR_TOKEN_DIR, { recursive: true, mode: 0o700 })
    // eslint-disable-next-line custom-rules/no-sync-fs -- one-shot startup write in CCR, caller is sync
    writeFileSync(path, token, { encoding: 'utf8', mode: 0o600 })
    logForDebugging(`Persisted ${tokenName} to ${path} for subprocess access`)
// 同步写盘：CCR 启动期一次性写入，调用方处于同步上下文（eslint 例外已注明），目录权限 0700、文件权限 0600。
  } catch (error) {
    logForDebugging(
      `Failed to persist ${tokenName} to disk (non-fatal): ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}
// maybePersistTokenForSubprocesses：仅当 CLAUDE_CODE_REMOTE 为真才把 token 写到已知位置，供无法继承 FD 的子进程读取。

/**
 * Fallback read from a well-known file. The path only exists in CCR (env-manager
 * creates the directory), so file-not-found is the expected outcome everywhere
 * else — treated as "no fallback", not an error.
 */
export function readTokenFromWellKnownFile(
  path: string,
  tokenName: string,
): string | null {
  try {
    const fsOps = getFsImplementation()
    // eslint-disable-next-line custom-rules/no-sync-fs -- fallback read for CCR subprocess path, one-shot at startup, caller is sync
    const token = fsOps.readFileSync(path, { encoding: 'utf8' }).trim()
    if (!token) {
      return null
    }
    logForDebugging(`Read ${tokenName} from well-known file ${path}`)
    return token
  } catch (error) {
    // ENOENT is the expected outcome outside CCR — stay silent. Anything
    // else (EACCES from perm misconfig, etc.) is worth surfacing in the
    // debug log so subprocess auth failures aren't mysterious.
    if (!isENOENT(error)) {
      logForDebugging(
        `Failed to read ${tokenName} from ${path}: ${errorMessage(error)}`,
        { level: 'debug' },
      )
    }
    return null
  }
}
// readTokenFromWellKnownFile：已知文件兜底读取；ENOENT 在非 CCR 环境是预期结果，静默返回 null，其它错误才记调试日志。

/**
 * Shared FD-or-well-known-file credential reader.
 *
 * Priority order:
 *  1. File descriptor (legacy path) — env var points at a pipe FD passed by
 *     the Go env-manager via cmd.ExtraFiles. Pipe is drained on first read
 *     and doesn't cross exec/tmux boundaries.
 *  2. Well-known file — written by this function on successful FD read (and
 *     eventually by the env-manager directly). Covers subprocesses that can't
 *     inherit the FD.
 *
 * Returns null if neither source has a credential. Cached in global state.
 */
function getCredentialFromFd({
// getCredentialFromFd 入口：统一按「FD 优先、已知文件兜底」的顺序读取凭证，结果缓存到全局状态。
  envVar,
  wellKnownPath,
  label,
  getCached,
  setCached,
}: {
  envVar: string
  wellKnownPath: string
  label: string
  getCached: () => string | null | undefined
  setCached: (value: string | null) => void
}): string | null {
  const cached = getCached()
  if (cached !== undefined) {
    return cached
  }

  const fdEnv = process.env[envVar]
  if (!fdEnv) {
    // No FD env var — either we're not in CCR, or we're a subprocess whose
    // parent stripped the (useless) FD env var. Try the well-known file.
    const fromFile = readTokenFromWellKnownFile(wellKnownPath, label)
    setCached(fromFile)
    return fromFile
  }
// 无 FD 环境变量时（非 CCR，或子进程剥离了无用的 FD 变量）回退读已知文件。

  const fd = parseInt(fdEnv, 10)
  if (Number.isNaN(fd)) {
    logForDebugging(
      `${envVar} must be a valid file descriptor number, got: ${fdEnv}`,
      { level: 'error' },
    )
    setCached(null)
    return null
  }
// FD 编号非法（非数字）则报错并缓存 null，避免后续重复解析。

  try {
    // Use /dev/fd on macOS/BSD, /proc/self/fd on Linux
    const fsOps = getFsImplementation()
    const fdPath =
      process.platform === 'darwin' || process.platform === 'freebsd'
        ? `/dev/fd/${fd}`
        : `/proc/self/fd/${fd}`

    // eslint-disable-next-line custom-rules/no-sync-fs -- legacy FD path, read once at startup, caller is sync
    const token = fsOps.readFileSync(fdPath, { encoding: 'utf8' }).trim()
    if (!token) {
      logForDebugging(`File descriptor contained empty ${label}`, {
        level: 'error',
      })
      setCached(null)
      return null
    }
    logForDebugging(`Successfully read ${label} from file descriptor ${fd}`)
    setCached(token)
    maybePersistTokenForSubprocesses(wellKnownPath, token, label)
    return token
  } catch (error) {
    logForDebugging(
      `Failed to read ${label} from file descriptor ${fd}: ${errorMessage(error)}`,
      { level: 'error' },
    )
    // FD env var was set but read failed — typically a subprocess that
    // inherited the env var but not the FD (ENXIO). Try the well-known file.
    const fromFile = readTokenFromWellKnownFile(wellKnownPath, label)
    setCached(fromFile)
    return fromFile
  }
}
// getCredentialFromFd 收尾：FD 读到非空 token 则缓存并落到已知文件；读取失败也回退到已知文件兜底。

/**
 * Get the CCR-injected OAuth token. See getCredentialFromFd for FD-vs-disk
 * rationale. Env var: CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR.
 * Well-known file: /home/claude/.claude/remote/.oauth_token.
 */
export function getOAuthTokenFromFileDescriptor(): string | null {
  return getCredentialFromFd({
    envVar: 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
    wellKnownPath: CCR_OAUTH_TOKEN_PATH,
    label: 'OAuth token',
    getCached: getOauthTokenFromFd,
    setCached: setOauthTokenFromFd,
  })
}
// getOAuthTokenFromFileDescriptor：OAuth token 读取入口，对应环境变量 CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR。

/**
 * Get the CCR-injected API key. See getCredentialFromFd for FD-vs-disk
 * rationale. Env var: CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR.
 * Well-known file: /home/claude/.claude/remote/.api_key.
 */
export function getApiKeyFromFileDescriptor(): string | null {
  return getCredentialFromFd({
    envVar: 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
    wellKnownPath: CCR_API_KEY_PATH,
    label: 'API key',
    getCached: getApiKeyFromFd,
    setCached: setApiKeyFromFd,
  })
}
// getApiKeyFromFileDescriptor：API key 读取入口，对应环境变量 CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR。
