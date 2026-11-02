// Git worktree 路径探测：调用 git worktree list 找出仓库所有工作树，并按「当前工作树优先、其余按字母序」返回。
import { sep } from 'path'
import { logEvent } from '../services/analytics/index.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { gitExe } from './git.js'

/**
 * Returns the paths of all worktrees for the current git repository.
 * If git is not available, not in a git repo, or only has one worktree,
 * returns an empty array.
 *
 * This version includes analytics tracking and uses the CLI's gitExe()
 * resolver. For a portable version without CLI deps, use
 * getWorktreePathsPortable().
 *
 * @param cwd Directory to run the command from
 * @returns Array of absolute worktree paths
 */
// 模块文档：本版本带埋点统计并使用 CLI 的 gitExe() 解析器；若要脱离 CLI 依赖的便携版，请用 getWorktreePathsPortable()。
// 主函数：从 cwd 跑 git worktree list --porcelain，非 git 环境、不在仓库或只有一个工作树时返回空数组。
export async function getWorktreePaths(cwd: string): Promise<string[]> {
  const startTime = Date.now()

  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    ['worktree', 'list', '--porcelain'],
    {
      cwd,
      preserveOutputOnError: false,
    },
  )
// 拿到 porcelain 输出的 stdout 与退出码；preserveOutputOnError 关掉以免错误时也缓存输出。

  const durationMs = Date.now() - startTime

  if (code !== 0) {
    logEvent('tengu_worktree_detection', {
      duration_ms: durationMs,
      worktree_count: 0,
      success: false,
    })
    return []
  }

  // Parse porcelain output - lines starting with "worktree " contain paths
  // Example:
  // worktree /Users/foo/repo
  // HEAD abc123
  // branch refs/heads/main
  //
  // worktree /Users/foo/repo-wt1
  // HEAD def456
  // branch refs/heads/feature
  const worktreePaths = stdout
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).normalize('NFC'))
// 把 porcelain 输出按行过滤出以「worktree 」开头的路径行，并做 NFC 归一化，得到原始工作树路径列表。

  logEvent('tengu_worktree_detection', {
    duration_ms: durationMs,
    worktree_count: worktreePaths.length,
    success: true,
  })

  // Sort worktrees: current worktree first, then alphabetically
  const currentWorktree = worktreePaths.find(
    path => cwd === path || cwd.startsWith(path + sep),
  )
// 定位「当前工作树」：cwd 等于某路径或以该路径加分隔符开头者即为当前；其余按 locale 排序。
  const otherWorktrees = worktreePaths
    .filter(path => path !== currentWorktree)
    .sort((a, b) => a.localeCompare(b))

  return currentWorktree ? [currentWorktree, ...otherWorktrees] : otherWorktrees
// 返回排序后的路径：当前工作树排在最前，其余按字母序；找不到当前时只返回其余列表。
}
