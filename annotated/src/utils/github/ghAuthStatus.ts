// 文件级批注：`ghAuthStatus.ts` 探测本地 `gh` CLI 的安装与鉴权状态，用于遥测上报，不直接参与鉴权流程。
import { execa } from 'execa'
import { which } from '../which.js'

export type GhAuthStatus =
  | 'authenticated'
  | 'not_authenticated'
  | 'not_installed'

// 类型定义收尾：`GhAuthStatus` 三态——已鉴权、未鉴权、未安装。
/**
 * Returns gh CLI install + auth status for telemetry.
 * Uses which() first (Bun.which — no subprocess) to detect install, then
 * exit code of `gh auth token` to detect auth. Uses `auth token` instead of
 * `auth status` because the latter makes a network request to GitHub's API,
 * while `auth token` only reads local config/keyring. Spawns with
 * stdout: 'ignore' so the token never enters this process.
 */
// 异步函数签名：先用 `which('gh')` 检测安装（Bun 原生、无子进程），再用 `gh auth token` 的退出码判断鉴权状态。
export async function getGhAuthStatus(): Promise<GhAuthStatus> {
  const ghPath = await which('gh')
  if (!ghPath) {
    return 'not_installed'
  }
  const { exitCode } = await execa('gh', ['auth', 'token'], {
    stdout: 'ignore',
    stderr: 'ignore',
    timeout: 5000,
    reject: false,
  })
  return exitCode === 0 ? 'authenticated' : 'not_authenticated'
}
// 函数收尾：退出码为 0 即已鉴权，否则判未鉴权；刻意用 `auth token` 而非 `auth status` 以避免触发 GitHub API 网络请求，`stdout:'ignore'` 保证令牌不进入本进程内存。
