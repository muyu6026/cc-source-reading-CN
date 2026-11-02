import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
// 本文件封装 git check-ignore 与全局 gitignore 写入，供敏感文件自动忽略使用。
import { homedir } from 'os'
import { dirname, join } from 'path'
import { getCwd } from '../cwd.js'
import { getErrnoCode } from '../errors.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { dirIsInGitRepo } from '../git.js'
import { logError } from '../log.js'

/**
 * Checks if a path is ignored by git (via `git check-ignore`).
 *
 * This consults all applicable gitignore sources: repo `.gitignore` files
 * (nested), `.git/info/exclude`, and the global gitignore — with correct
 * precedence, because git itself resolves it.
 *
 * Exit codes: 0 = ignored, 1 = not ignored, 128 = not in a git repo.
 * Returns `false` for 128, so callers outside a git repo fail open.
 *
 * @param filePath The path to check (absolute or relative to cwd)
 * @param cwd The working directory to run git from
 */
export async function isPathGitignored(
// 调 git check-ignore 判断路径是否被忽略：退出码 0 表示已忽略、1 表示未忽略、128 表示不在仓库；128 时返回 false（仓库外放行）。
  filePath: string,
  cwd: string,
): Promise<boolean> {
  const { code } = await execFileNoThrowWithCwd(
    'git',
    ['check-ignore', filePath],
    {
      preserveOutputOnError: false,
      cwd,
    },
  )

  return code === 0
}

/**
 * Gets the path to the global gitignore file (.config/git/ignore)
 * @returns The path to the global gitignore file
 */
export function getGlobalGitignorePath(): string {
// 返回全局 gitignore 路径（位于用户配置目录下的 git/ignore）。
  return join(homedir(), '.config', 'git', 'ignore')
}

/**
 * Adds a file pattern to the global gitignore file (.config/git/ignore)
 * if it's not already ignored by existing patterns in any gitignore file
 * @param filename The filename to add to gitignore
 * @param cwd The current working directory (optional)
 */
export async function addFileGlobRuleToGitignore(
// 把某文件名加入全局 gitignore（用 **/文件名 兜底所有子目录），前提是仓库内且尚未被任何 gitignore 覆盖。
  filename: string,
  cwd: string = getCwd(),
): Promise<void> {
  try {
    if (!(await dirIsInGitRepo(cwd))) {
      return
    }

    // First check if the pattern is already ignored by any gitignore file (including global)
    const gitignoreEntry = `**/${filename}`
    // For directory patterns (ending with /), check with a sample file inside
    const testPath = filename.endsWith('/')
      ? `${filename}sample-file.txt`
      : filename
    if (await isPathGitignored(testPath, cwd)) {
// 若已被现有规则忽略则直接返回，不重复添加。
      // File is already ignored by existing patterns (local or global)
      return
    }

    // Use the global gitignore file in .config/git/ignore
    const globalGitignorePath = getGlobalGitignorePath()

    // Create the directory if it doesn't exist
    const configGitDir = dirname(globalGitignorePath)
    await mkdir(configGitDir, { recursive: true })

    // Add the entry to the global gitignore
    try {
// 确保全局 gitignore 所在目录存在后再追加条目。
      const content = await readFile(globalGitignorePath, { encoding: 'utf-8' })
      if (content.includes(gitignoreEntry)) {
        return // Pattern already exists, don't add again
      }
      await appendFile(globalGitignorePath, `\n${gitignoreEntry}\n`)
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        // Create global gitignore with entry
        await writeFile(globalGitignorePath, `${gitignoreEntry}\n`, 'utf-8')
      } else {
        throw e
      }
    }
  } catch (error) {
    logError(error)
  }
}
