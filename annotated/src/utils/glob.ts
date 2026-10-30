import { basename, dirname, isAbsolute, join, sep } from 'path'
import type { ToolPermissionContext } from '../Tool.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getFileReadIgnorePatterns,
  normalizePatternsToPath,
} from './permissions/filesystem.js'
import { getPlatform } from './platform.js'
import { getGlobExclusionsForPluginCache } from './plugins/orphanedPluginFilter.js'
import { ripGrep } from './ripgrep.js'
// 全局文件 glob 工具：基于 ripgrep 的 --files 列出匹配模式的文件，支持绝对路径转相对、忽略模式、隐藏/--no-ignore 开关与孤儿插件目录排除。

/**
 * Extracts the static base directory from a glob pattern.
 * The base directory is everything before the first glob special character (* ? [ {).
 * Returns the directory portion and the remaining relative pattern.
 */
// 从 glob 模式里抽取「静态基目录」——即第一个通配符（星号、问号、左方括号、左花括号）之前的部分，返回基目录与剩余相对模式。
export function extractGlobBaseDirectory(pattern: string): {
  baseDir: string
  relativePattern: string
} {
  // Find the first glob special character: *, ?, [, {
  const globChars = /[*?[{]/
  const match = pattern.match(globChars)

  if (!match || match.index === undefined) {
// 若模式里没有通配符，它就是字面路径：把目录部分与文件名拆开返回。
    // No glob characters - this is a literal path
    // Return the directory portion and filename as pattern
    const dir = dirname(pattern)
    const file = basename(pattern)
    return { baseDir: dir, relativePattern: file }
  }

  // Get everything before the first glob character
  const staticPrefix = pattern.slice(0, match.index)

  // Find the last path separator in the static prefix
  const lastSepIndex = Math.max(
    staticPrefix.lastIndexOf('/'),
    staticPrefix.lastIndexOf(sep),
  )

  if (lastSepIndex === -1) {
// 若通配符前没有路径分隔符，说明模式相对 cwd，基目录置空。
    // No path separator before the glob - pattern is relative to cwd
    return { baseDir: '', relativePattern: pattern }
  }

  let baseDir = staticPrefix.slice(0, lastSepIndex)
  const relativePattern = pattern.slice(lastSepIndex + 1)

  // Handle root directory patterns (e.g., /*.txt on Unix or C:/*.txt on Windows)
  // When lastSepIndex is 0, baseDir is empty but we need to use '/' as the root
// 处理根目录模式（如 Unix 的 /*.txt 或 Windows 的 C:/*.txt）：当 lastSepIndex 为 0 时基目录置空但需补斜杠作为根。
  if (baseDir === '' && lastSepIndex === 0) {
    baseDir = '/'
  }

  // Handle Windows drive root paths (e.g., C:/*.txt)
  // 'C:' means "current directory on drive C" (relative), not root
  // We need 'C:/' or 'C:\' for the actual drive root
// Windows 盘符根路径（C:/*.txt）：C: 本表示「C 盘当前目录」（相对），需补分隔符成 C:/ 或 C:/ 才是真正盘根。
  if (getPlatform() === 'windows' && /^[A-Za-z]:$/.test(baseDir)) {
    baseDir = baseDir + sep
  }

  return { baseDir, relativePattern }
}

export async function glob(
  filePattern: string,
  cwd: string,
  { limit, offset }: { limit: number; offset: number },
  abortSignal: AbortSignal,
  toolPermissionContext: ToolPermissionContext,
): Promise<{ files: string[]; truncated: boolean }> {
// 主入口：在 cwd 下用 ripgrep 列出匹配模式的文件，支持 limit/offset 分页与 truncated 标记。
  let searchDir = cwd
  let searchPattern = filePattern

  // Handle absolute paths by extracting the base directory and converting to relative pattern
  // ripgrep's --glob flag only works with relative patterns
  if (isAbsolute(filePattern)) {
// 若模式是绝对路径，先抽取基目录并转成相对模式（ripgrep 的 --glob 只吃相对模式）。
    const { baseDir, relativePattern } = extractGlobBaseDirectory(filePattern)
    if (baseDir) {
      searchDir = baseDir
      searchPattern = relativePattern
    }
  }

  const ignorePatterns = normalizePatternsToPath(
    getFileReadIgnorePatterns(toolPermissionContext),
    searchDir,
  )

  // Use ripgrep for better memory performance
  // --files: list files instead of searching content
  // --glob: filter by pattern
  // --sort=modified: sort by modification time (oldest first)
  // --no-ignore: don't respect .gitignore (default true, set CLAUDE_CODE_GLOB_NO_IGNORE=false to respect .gitignore)
  // --hidden: include hidden files (default true, set CLAUDE_CODE_GLOB_HIDDEN=false to exclude)
  // Note: use || instead of ?? to treat empty string as unset (defaulting to true)
// 用 ripgrep 而非遍历目录以省内存；注释随后列举各 flag 含义：--files 列文件、--glob 过滤、--sort=modified 按修改时间排序等。
  const noIgnore = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_NO_IGNORE || 'true')
// 是否尊重 .gitignore：默认不尊重（--no-ignore），可用环境变量 CLAUDE_CODE_GLOB_NO_IGNORE=false 改变；隐藏文件同理。用 || 而非 ??，以把空串也当作「未设置（默认 true）」。
  const hidden = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_HIDDEN || 'true')
  const args = [
    '--files',
    '--glob',
    searchPattern,
    '--sort=modified',
    ...(noIgnore ? ['--no-ignore'] : []),
    ...(hidden ? ['--hidden'] : []),
  ]

  // Add ignore patterns
  for (const pattern of ignorePatterns) {
    args.push('--glob', `!${pattern}`)
  }

  // Exclude orphaned plugin version directories
  for (const exclusion of await getGlobExclusionsForPluginCache(searchDir)) {
    args.push('--glob', exclusion)
  }

  const allPaths = await ripGrep(args, searchDir, abortSignal)
// 调用 ripgrep 拿到相对路径列表。

  // ripgrep returns relative paths, convert to absolute
  const absolutePaths = allPaths.map(p =>
    isAbsolute(p) ? p : join(searchDir, p),
  )

  const truncated = absolutePaths.length > offset + limit
// 按 limit/offset 切片，超界则标记 truncated。
  const files = absolutePaths.slice(offset, offset + limit)

  return { files, truncated }
}
