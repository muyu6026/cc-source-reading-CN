// 文件级批注：`getWorktreePathsPortable.ts` 用最轻量的 `child_process` 探测 git worktree 列表，刻意不引入 execa/cross-spawn/which 依赖链，供 SDK 端 `listSessionsImpl` 等场景使用。
import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFileCb)

/**
 * Portable worktree detection using only child_process — no analytics,
 * no bootstrap deps, no execa. Used by listSessionsImpl.ts (SDK) and
 * anywhere that needs worktree paths without pulling in the CLI
 * dependency chain (execa → cross-spawn → which).
 */
// 异步函数签名：给定工作目录，调用 `git worktree list --porcelain` 解析出所有 worktree 路径。
export async function getWorktreePathsPortable(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['worktree', 'list', '--porcelain'],
      { cwd, timeout: 5000 },
    )
    if (!stdout) return []
    return stdout
      .split('\n')
      .filter(line => line.startsWith('worktree '))
      .map(line => line.slice('worktree '.length).normalize('NFC'))
  } catch {
    return []
  }
}
// 函数收尾：按 `worktree ` 前缀过滤并截取路径、做 NFC 归一化；任何异常（含超时）都返回空数组而非抛错。
