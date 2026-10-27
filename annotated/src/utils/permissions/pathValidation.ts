import memoize from 'lodash-es/memoize.js'
// 文件级摘要：路径安全校验模块，在文件读写或创建前对路径做沙箱、拒绝规则、内部路径、UNC、shell 展开、glob 等多层安全检查。
import { homedir } from 'os'
import { dirname, isAbsolute, resolve } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
import { getPlatform } from '../../utils/platform.js'
import {
  getFsImplementation,
  getPathsForPermissionCheck,
  safeResolvePath,
} from '../fsOperations.js'
import { containsPathTraversal } from '../path.js'
import { SandboxManager } from '../sandbox/sandbox-adapter.js'
import { containsVulnerableUncPath } from '../shell/readOnlyCommandValidation.js'
import {
  checkEditableInternalPath,
  checkPathSafetyForAutoEdit,
  checkReadableInternalPath,
  matchingRuleForInput,
  pathInAllowedWorkingPath,
  pathInWorkingPath,
} from './filesystem.js'
import type { PermissionDecisionReason } from './PermissionResult.js'

const MAX_DIRS_TO_LIST = 5
// `MAX_DIRS_TO_LIST` 控制目录列表最多展示几个，超出用「and N more」省略。
const GLOB_PATTERN_REGEX = /[*?[\]{}]/

export type FileOperationType = 'read' | 'write' | 'create'

export type PathCheckResult = {
  allowed: boolean
  decisionReason?: PermissionDecisionReason
}

export type ResolvedPathCheckResult = PathCheckResult & {
  resolvedPath: string
}

export function formatDirectoryList(directories: string[]): string {
// `formatDirectoryList`：把目录数组格式化成带引号、超量省略的展示串。
  const dirCount = directories.length

  if (dirCount <= MAX_DIRS_TO_LIST) {
    return directories.map(dir => `'${dir}'`).join(', ')
  }

  const firstDirs = directories
    .slice(0, MAX_DIRS_TO_LIST)
    .map(dir => `'${dir}'`)
    .join(', ')

  return `${firstDirs}, and ${dirCount - MAX_DIRS_TO_LIST} more`
}

/**
 * Extracts the base directory from a glob pattern for validation.
 * For example: "/path/to/*.txt" returns "/path/to"
 */
// `getGlobBaseDirectory`：从 glob 模式里取出基础目录，供后续对该目录做权限校验。
export function getGlobBaseDirectory(path: string): string {
  const globMatch = path.match(GLOB_PATTERN_REGEX)
  if (!globMatch || globMatch.index === undefined) {
    return path
  }

  // Get everything before the first glob character
  const beforeGlob = path.substring(0, globMatch.index)

  // Find the last directory separator
  const lastSepIndex =
    getPlatform() === 'windows'
      ? Math.max(beforeGlob.lastIndexOf('/'), beforeGlob.lastIndexOf('\\'))
      : beforeGlob.lastIndexOf('/')
  if (lastSepIndex === -1) return '.'

  return beforeGlob.substring(0, lastSepIndex) || '/'
}

/**
 * Expands tilde (~) at the start of a path to the user's home directory.
 * Note: ~username expansion is not supported for security reasons.
 */
// `expandTilde`：把路径开头的 `~` 展开成用户主目录（出于安全不支持 `~user` 形式）。
export function expandTilde(path: string): string {
  if (
    path === '~' ||
    path.startsWith('~/') ||
    (process.platform === 'win32' && path.startsWith('~\\'))
  ) {
    return homedir() + path.slice(1)
  }
  return path
}

/**
 * Checks if a resolved path is writable according to the sandbox write allowlist.
 * When the sandbox is enabled, the user has explicitly configured which directories
 * are writable. We treat these as additional allowed write directories for path
 * validation purposes, so commands like `echo foo > /tmp/claude/x.txt` don't
 * prompt for permission when /tmp/claude/ is already in the sandbox allowlist.
 *
 * Respects the deny-within-allow list: paths in denyWithinAllow (like
 * .claude/settings.json) are still blocked even if their parent is in allowOnly.
 */
// `isPathInSandboxWriteAllowlist`：沙箱开启时，用户显式配置的可写目录也算作额外允许写目录。
export function isPathInSandboxWriteAllowlist(resolvedPath: string): boolean {
  if (!SandboxManager.isSandboxingEnabled()) {
    return false
  }
  const { allowOnly, denyWithinAllow } = SandboxManager.getFsWriteConfig()
  // Resolve symlinks on both sides so comparisons are symmetric (matching
  // pathInAllowedWorkingPath). Without this, an allowlist entry that is a
  // symlink (e.g. /home/user/proj -> /data/proj) would not match a write to
  // its resolved target, causing an unnecessary prompt. Over-conservative,
  // not a security issue. All resolved input representations must be allowed
  // and none may be denied. Config paths are session-stable, so memoize
  // their resolution to avoid N × config.length redundant syscalls per
  // command with N write targets (matching getResolvedWorkingDirPaths).
  const pathsToCheck = getPathsForPermissionCheck(resolvedPath)
// 对符号链接两端都解析，确保 allowlist 里的软链与其真实目标都能匹配，避免多余提示。
  const resolvedAllow = allowOnly.flatMap(getResolvedSandboxConfigPath)
  const resolvedDeny = denyWithinAllow.flatMap(getResolvedSandboxConfigPath)
  return pathsToCheck.every(p => {
    for (const denyPath of resolvedDeny) {
      if (pathInWorkingPath(p, denyPath)) return false
    }
    return resolvedAllow.some(allowPath => pathInWorkingPath(p, allowPath))
  })
}

// Sandbox config paths are session-stable; memoize their resolved forms to
// avoid repeated lstat/realpath syscalls on every write-target check.
// Matches the getResolvedWorkingDirPaths pattern in filesystem.ts.
const getResolvedSandboxConfigPath = memoize(getPathsForPermissionCheck)

/**
 * Checks if a resolved path is allowed for the given operation type.
 *
 * @param precomputedPathsToCheck - Optional cached result of
 *   `getPathsForPermissionCheck(resolvedPath)`. When `resolvedPath` is the
 *   output of `realpathSync` (canonical path, all symlinks resolved), this
 *   is trivially `[resolvedPath]` and passing it here skips 5 redundant
 *   syscalls per inner check. Do NOT pass this for non-canonical paths
 *   (nonexistent files, UNC paths, etc.) — parent-directory symlink
 *   resolution is still required for those.
 */
// `isPathAllowed`：路径校验的总裁判，按「拒绝对规则、内部可编辑、安全校验、工作目录、内部可读、沙箱白名单、允许规则」顺序判定。
export function isPathAllowed(
  resolvedPath: string,
  context: ToolPermissionContext,
  operationType: FileOperationType,
  precomputedPathsToCheck?: readonly string[],
): PathCheckResult {
  // Determine which permission type to check based on operation
  const permissionType = operationType === 'read' ? 'read' : 'edit'

  // 1. Check deny rules first (they take precedence)
  const denyRule = matchingRuleForInput(
// 第 1 步：先查拒绝对规则，命中直接拒绝，优先级最高。
    resolvedPath,
    context,
    permissionType,
    'deny',
  )
  if (denyRule !== null) {
    return {
      allowed: false,
      decisionReason: { type: 'rule', rule: denyRule },
    }
  }

  // 2. For write/create operations, check internal editable paths (plan files, scratchpad, agent memory, job dirs)
  // This MUST come before checkPathSafetyForAutoEdit since .claude is a dangerous directory
  // and internal editable paths live under ~/.claude/ — matching the ordering in
  // checkWritePermissionForTool (filesystem.ts step 1.5)
  if (operationType !== 'read') {
// 第 2 步：写或创建操作先查内部可编辑路径（计划文件、草稿、agent 记忆等），这些必须在查工作目录前。
    const internalEditResult = checkEditableInternalPath(resolvedPath, {})
    if (internalEditResult.behavior === 'allow') {
      return {
        allowed: true,
        decisionReason: internalEditResult.decisionReason,
      }
    }
  }

  // 2.5. For write/create operations, check comprehensive safety validations
  // This MUST come before checking working directory to prevent bypass via acceptEdits mode
  // Checks: Windows patterns, Claude config files, dangerous files (on original + symlink paths)
  if (operationType !== 'read') {
// 第 2.5 步：写或创建操作再做全面安全校验（Windows 模式、配置文件、危险文件），必须在工作目录判断前。
    const safetyCheck = checkPathSafetyForAutoEdit(
      resolvedPath,
      precomputedPathsToCheck,
    )
    if (!safetyCheck.safe) {
      return {
        allowed: false,
        decisionReason: {
          type: 'safetyCheck',
          reason: safetyCheck.message,
          classifierApprovable: safetyCheck.classifierApprovable,
        },
      }
    }
  }

  // 3. Check if path is in allowed working directory
  // For write/create operations, require acceptEdits mode to auto-allow
  // This is consistent with checkWritePermissionForTool in filesystem.ts
  const isInWorkingDir = pathInAllowedWorkingPath(
// 第 3 步：路径在工作目录内时，读操作或 acceptEdits 模式可直接放行。
    resolvedPath,
    context,
    precomputedPathsToCheck,
  )
  if (isInWorkingDir) {
    if (operationType === 'read' || context.mode === 'acceptEdits') {
      return { allowed: true }
    }
    // Write/create without acceptEdits mode falls through to check allow rules
  }

  // 3.5. For read operations, check internal readable paths (project temp dir, session memory, etc.)
  // This allows reading agent output files without explicit permission
  if (operationType === 'read') {
// 第 3.5 步：读操作额外查内部可读路径（项目临时目录、会话记忆等），无需显式授权。
    const internalReadResult = checkReadableInternalPath(resolvedPath, {})
    if (internalReadResult.behavior === 'allow') {
      return {
        allowed: true,
        decisionReason: internalReadResult.decisionReason,
      }
    }
  }

  // 3.7. For write/create operations to paths OUTSIDE the working directory,
  // check the sandbox write allowlist. When the sandbox is enabled, users
  // have explicitly configured writable directories (e.g. /tmp/claude/) —
  // treat these as additional allowed write directories so redirects/touch/
  // mkdir don't prompt unnecessarily. Safety checks (step 2) already ran.
  // Paths IN the working directory are intentionally excluded: the sandbox
  // allowlist always seeds '.' (cwd, see sandbox-adapter.ts), which would
  // bypass the acceptEdits gate at step 3. Step 3 handles those.
  if (
// 第 3.7 步：工作目录外的写操作若命中沙箱白名单也可放行，但工作目录内故意排除，防止绕过 acceptEdits 门槛。
    operationType !== 'read' &&
    !isInWorkingDir &&
    isPathInSandboxWriteAllowlist(resolvedPath)
  ) {
    return {
      allowed: true,
      decisionReason: {
        type: 'other',
        reason: 'Path is in sandbox write allowlist',
      },
    }
  }

  // 4. Check allow rules for the operation type
  const allowRule = matchingRuleForInput(
    resolvedPath,
    context,
    permissionType,
    'allow',
  )
  if (allowRule !== null) {
    return {
      allowed: true,
      decisionReason: { type: 'rule', rule: allowRule },
    }
  }

  // 5. Path is not allowed
  return { allowed: false }
}

/**
 * Validates a glob pattern by checking its base directory.
 * Returns the validation result for the base path where the glob would expand.
 */
// `validateGlobPattern`：对含路径穿越的 glob 先解析绝对路径再校验，否则只校验基础目录。
export function validateGlobPattern(
  cleanPath: string,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  operationType: FileOperationType,
): ResolvedPathCheckResult {
  if (containsPathTraversal(cleanPath)) {
    // For patterns with path traversal, resolve the full path
    const absolutePath = isAbsolute(cleanPath)
      ? cleanPath
      : resolve(cwd, cleanPath)
    const { resolvedPath, isCanonical } = safeResolvePath(
      getFsImplementation(),
      absolutePath,
    )
    const result = isPathAllowed(
      resolvedPath,
      toolPermissionContext,
      operationType,
      isCanonical ? [resolvedPath] : undefined,
    )
    return {
      allowed: result.allowed,
      resolvedPath,
      decisionReason: result.decisionReason,
    }
  }

  const basePath = getGlobBaseDirectory(cleanPath)
  const absoluteBasePath = isAbsolute(basePath)
    ? basePath
    : resolve(cwd, basePath)
  const { resolvedPath, isCanonical } = safeResolvePath(
    getFsImplementation(),
    absoluteBasePath,
  )
  const result = isPathAllowed(
    resolvedPath,
    toolPermissionContext,
    operationType,
    isCanonical ? [resolvedPath] : undefined,
  )
  return {
    allowed: result.allowed,
    resolvedPath,
    decisionReason: result.decisionReason,
  }
}

const WINDOWS_DRIVE_ROOT_REGEX = /^[A-Za-z]:\/?$/
// `WINDOWS_DRIVE_ROOT_REGEX` 等常量用于识别 Windows 盘符根与直接子项。
const WINDOWS_DRIVE_CHILD_REGEX = /^[A-Za-z]:\/[^/]+$/

/**
 * Checks if a resolved path is dangerous for removal operations (rm/rmdir).
 * Dangerous paths are:
 * - Wildcard '*' (removes all files in directory)
 * - Any path ending with '/*' or '\*' (e.g., /path/to/dir/*, C:\foo\*)
 * - Root directory (/)
 * - Home directory (~)
 * - Direct children of root (/usr, /tmp, /etc, etc.)
 * - Windows drive root (C:\, D:\) and direct children (C:\Windows, C:\Users)
 */
// `isDangerousRemovalPath`：识别删除操作的危险路径——通配、根目录、主目录、盘符根及其直接子项。
export function isDangerousRemovalPath(resolvedPath: string): boolean {
  // Callers pass both slash forms; collapse runs so C:\\Windows (valid in
  // PowerShell) doesn't bypass the drive-child check.
  const forwardSlashed = resolvedPath.replace(/[\\/]+/g, '/')
// 把斜杠各类写法归一，避免 `C:/Windows` 这类 PowerShell 写法绕过盘符子项检查。

  if (forwardSlashed === '*' || forwardSlashed.endsWith('/*')) {
    return true
  }

  const normalizedPath =
    forwardSlashed === '/' ? forwardSlashed : forwardSlashed.replace(/\/$/, '')

  if (normalizedPath === '/') {
    return true
  }

  if (WINDOWS_DRIVE_ROOT_REGEX.test(normalizedPath)) {
    return true
  }

  const normalizedHome = homedir().replace(/[\\/]+/g, '/')
  if (normalizedPath === normalizedHome) {
    return true
  }

  // Direct children of root: /usr, /tmp, /etc (but not /usr/local)
  const parentDir = dirname(normalizedPath)
  if (parentDir === '/') {
    return true
  }

  if (WINDOWS_DRIVE_CHILD_REGEX.test(normalizedPath)) {
    return true
  }

  return false
}

/**
 * Validates a file system path, handling tilde expansion and glob patterns.
 * Returns whether the path is allowed and the resolved path for error messages.
 */
// `validatePath`：对外总入口，先去引号与波浪号展开，再逐层做 UNC、shell 展开、glob、解析与最终校验。
export function validatePath(
  path: string,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  operationType: FileOperationType,
): ResolvedPathCheckResult {
  // Remove surrounding quotes if present
  const cleanPath = expandTilde(path.replace(/^['"]|['"]$/g, ''))

  // SECURITY: Block UNC paths that could leak credentials
  if (containsVulnerableUncPath(cleanPath)) {
// 安全红线：含漏洞 UNC 路径（可能泄露凭据）一律拒绝，需人工审批。
    return {
      allowed: false,
      resolvedPath: cleanPath,
      decisionReason: {
        type: 'other',
        reason: 'UNC network paths require manual approval',
      },
    }
  }

  // SECURITY: Reject tilde variants (~user, ~+, ~-, ~N) that expandTilde doesn't handle.
  // expandTilde resolves ~ and ~/ to $HOME, but ~root, ~+, ~- etc. are left as literal
  // text and resolved as relative paths (e.g., /cwd/~root/.ssh/id_rsa).
  // The shell expands these differently (~root → /var/root, ~+ → $PWD, ~- → $OLDPWD),
  // creating a TOCTOU gap: we validate /cwd/~root/... but bash reads /var/root/...
  // This check is safe from false positives because expandTilde already converted
  // ~ and ~/ to absolute paths starting with /, so only unexpanded variants remain.
  if (cleanPath.startsWith('~')) {
// 拒绝未被 `expandTilde` 处理的 `~user`、`~+` 等变体，避免「校验 /cwd/~root 但 bash 读 /var/root」的 TOCTOU 缺口。
    return {
      allowed: false,
      resolvedPath: cleanPath,
      decisionReason: {
        type: 'other',
        reason:
          'Tilde expansion variants (~user, ~+, ~-) in paths require manual approval',
      },
    }
  }

  // SECURITY: Reject paths containing ANY shell expansion syntax ($ or % characters,
  // or paths starting with = which triggers Zsh equals expansion)
  // - $VAR (Unix/Linux environment variables like $HOME, $PWD)
  // - ${VAR} (brace expansion)
  // - $(cmd) (command substitution)
  // - %VAR% (Windows environment variables like %TEMP%, %USERPROFILE%)
  // - Nested combinations like $(echo $HOME)
  // - =cmd (Zsh equals expansion, e.g. =rg expands to /usr/bin/rg)
  // All of these are preserved as literal strings during validation but expanded
  // by the shell during execution, creating a TOCTOU vulnerability
  if (
// 拒绝含 `$`、`%`、`=` 等 shell 展开语法的路径，因为这些在校验时是字面量、执行时却被展开，存在 TOCTOU 漏洞。
    cleanPath.includes('$') ||
    cleanPath.includes('%') ||
    cleanPath.startsWith('=')
  ) {
    return {
      allowed: false,
      resolvedPath: cleanPath,
      decisionReason: {
        type: 'other',
        reason: 'Shell expansion syntax in paths requires manual approval',
      },
    }
  }

  // SECURITY: Block glob patterns in write/create operations
  // Write tools don't expand globs - they use paths literally.
  // Allowing globs in write operations could bypass security checks.
  // Example: /allowed/dir/*.txt would only validate /allowed/dir,
  // but the actual write would use the literal path with the *
  if (GLOB_PATTERN_REGEX.test(cleanPath)) {
// 写或创建操作禁止 glob 模式（写工具按字面用路径），读操作则只校验 glob 将展开到的基础目录。
    if (operationType === 'write' || operationType === 'create') {
      return {
        allowed: false,
        resolvedPath: cleanPath,
        decisionReason: {
          type: 'other',
          reason:
            'Glob patterns are not allowed in write operations. Please specify an exact file path.',
        },
      }
    }

    // For read operations, validate the base directory where the glob would expand
    return validateGlobPattern(
      cleanPath,
      cwd,
      toolPermissionContext,
      operationType,
    )
  }

  // Resolve path
  const absolutePath = isAbsolute(cleanPath)
    ? cleanPath
    : resolve(cwd, cleanPath)
  const { resolvedPath, isCanonical } = safeResolvePath(
    getFsImplementation(),
    absolutePath,
  )

  const result = isPathAllowed(
    resolvedPath,
    toolPermissionContext,
    operationType,
    isCanonical ? [resolvedPath] : undefined,
  )
  return {
    allowed: result.allowed,
    resolvedPath,
    decisionReason: result.decisionReason,
  }
}
