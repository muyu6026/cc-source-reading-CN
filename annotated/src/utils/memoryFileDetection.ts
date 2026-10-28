// 模块总览：会话与记忆类文件的识别。
// 提供一组判断函数，区分哪些路径属于 Claude 自动管理的记忆文件（自动记忆、团队记忆、
// 会话记忆/转录、智能体记忆），哪些属于用户自管的指令文件（CLAUDE.md 等），
// 供权限判定与折叠徽标逻辑使用。
import { feature } from 'bun:bundle'
import { normalize, posix, win32 } from 'path'
import {
  getAutoMemPath,
  getMemoryBaseDir,
  isAutoMemoryEnabled,
  isAutoMemPath,
} from '../memdir/paths.js'
import { isAgentMemoryPath } from '../tools/AgentTool/agentMemory.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import {
  posixPathToWindowsPath,
  windowsPathToPosixPath,
} from './windowsPaths.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemPaths = feature('TEAMMEM')
  ? (require('../memdir/teamMemPaths.js') as typeof import('../memdir/teamMemPaths.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

const IS_WINDOWS = process.platform === 'win32'

// Normalize path separators to posix (/). Does NOT translate drive encoding.
function toPosix(p: string): string {
  return p.split(win32.sep).join(posix.sep)
}
// 路径归一化小工具：把 Windows 反斜杠换成正斜杠，便于统一按字符串比较。

// Convert a path to a stable string-comparable form: forward-slash separated,
// and on Windows, lowercased (Windows filesystems are case-insensitive).
function toComparable(p: string): string {
  const posixForm = toPosix(p)
  return IS_WINDOWS ? posixForm.toLowerCase() : posixForm
}
// 可比较形式：在归一化基础上，Windows 下再整体转小写，因为 Windows 文件系统大小写不敏感。

/**
 * Detects if a file path is a session-related file under ~/.claude.
 * Returns the type of session file or null if not a session file.
 */
export function detectSessionFileType(
  filePath: string,
): 'session_memory' | 'session_transcript' | null {
  const configDir = getClaudeConfigHomeDir()
  // Compare in forward-slash form; on Windows also case-fold. The caller
  // (isShellCommandTargetingMemory) converts MinGW /c/... → native before
  // reaching here, so we only need separator + case normalization.
  const normalized = toComparable(filePath)
  const configDirCmp = toComparable(configDir)
  if (!normalized.startsWith(configDirCmp)) {
    return null
  }
  if (normalized.includes('/session-memory/') && normalized.endsWith('.md')) {
    return 'session_memory'
  }
  if (normalized.includes('/projects/') && normalized.endsWith('.jsonl')) {
    return 'session_transcript'
  }
  return null
}
// 判断单个路径是否落在 ~/.claude 下的会话相关文件：会话记忆（.md）或会话转录（.jsonl）。

/**
 * Checks if a glob/pattern string indicates session file access intent.
 * Used for Grep/Glob tools where we check patterns, not actual file paths.
 */
export function detectSessionPatternType(
  pattern: string,
): 'session_memory' | 'session_transcript' | null {
  const normalized = pattern.split(win32.sep).join(posix.sep)
  if (
    normalized.includes('session-memory') &&
    (normalized.includes('.md') || normalized.endsWith('*'))
  ) {
    return 'session_memory'
  }
  if (
    normalized.includes('.jsonl') ||
    (normalized.includes('projects') && normalized.includes('*.jsonl'))
  ) {
    return 'session_transcript'
  }
  return null
}
// 判断 glob 模式串（而非真实路径）是否指向会话文件，用于 Grep/Glob 这类只拿到模式串的工具。

/**
 * Check if a file path is within the memdir directory.
 */
export function isAutoMemFile(filePath: string): boolean {
  if (isAutoMemoryEnabled()) {
    return isAutoMemPath(filePath)
  }
  return false
}
// 自动记忆开关打开时，路径落在自动记忆目录下即判定为自动记忆文件。

export type MemoryScope = 'personal' | 'team'

/**
 * Determine which memory store (if any) a path belongs to.
 *
 * Team dir is a subdirectory of memdir (getTeamMemPath = join(getAutoMemPath, 'team')),
 * so a team path matches both isTeamMemFile and isAutoMemFile. Check team first.
 *
 * Use this for scope-keyed telemetry where a single event name distinguishes
 * by scope field — the existing tengu_memdir_* / tengu_team_mem_* event-name
 * hierarchy handles the overlap differently (team writes intentionally fire both).
 */
export function memoryScopeForPath(filePath: string): MemoryScope | null {
  if (feature('TEAMMEM') && teamMemPaths!.isTeamMemFile(filePath)) {
    return 'team'
  }
  if (isAutoMemFile(filePath)) {
    return 'personal'
  }
  return null
}
// 判断路径归属哪个记忆作用域（个人还是团队）；
// 团队目录是自动记忆目录的子目录，所以会同时命中两类判定，这里优先判团队。

/**
 * Check if a file path is within an agent memory directory.
 */
function isAgentMemFile(filePath: string): boolean {
  if (isAutoMemoryEnabled()) {
    return isAgentMemoryPath(filePath)
  }
  return false
}
// 内部辅助：判断路径是否落在智能体记忆目录，复用自动记忆开关的同一道闸。

/**
 * Check if a file is a Claude-managed memory file (NOT user-managed instruction files).
 * Includes: auto-memory (memdir), agent memory, session memory/transcripts.
 * Excludes: CLAUDE.md, CLAUDE.local.md, .claude/rules/*.md (user-managed).
 *
 * Use this for collapse/badge logic where user-managed files should show full diffs.
 */
export function isAutoManagedMemoryFile(filePath: string): boolean {
  if (isAutoMemFile(filePath)) {
    return true
  }
  if (feature('TEAMMEM') && teamMemPaths!.isTeamMemFile(filePath)) {
    return true
  }
  if (detectSessionFileType(filePath) !== null) {
    return true
  }
  if (isAgentMemFile(filePath)) {
    return true
  }
  return false
}
// 综合判定：自动记忆、团队记忆、会话记忆/转录、智能体记忆四类任一命中即算自动托管记忆文件，
// 从而与用户自管的指令文件区分开。

// Check if a directory path is a memory-related directory.
// Used by Grep/Glob which take a directory `path` rather than a specific file.
// Checks both configDir and memoryBaseDir to handle custom memory dir paths.
export function isMemoryDirectory(dirPath: string): boolean {
  // SECURITY: Normalize to prevent path traversal bypasses via .. segments.
  // On Windows this produces backslashes; toComparable flips them back for
  // string matching. MinGW /c/... paths are converted to native before
  // reaching here (extraction-time in isShellCommandTargetingMemory), so
  // normalize() never sees them.
  const normalizedPath = normalize(dirPath)
  const normalizedCmp = toComparable(normalizedPath)
  // Agent memory directories can be under cwd (project scope), configDir, or memoryBaseDir
  if (
    isAutoMemoryEnabled() &&
    (normalizedCmp.includes('/agent-memory/') ||
      normalizedCmp.includes('/agent-memory-local/'))
  ) {
    return true
  }
  // Team memory directories live under <autoMemPath>/team/
  if (
    feature('TEAMMEM') &&
    teamMemPaths!.isTeamMemoryEnabled() &&
    teamMemPaths!.isTeamMemPath(normalizedPath)
  ) {
    return true
  }
  // Check the auto-memory path override (CLAUDE_COWORK_MEMORY_PATH_OVERRIDE)
  if (isAutoMemoryEnabled()) {
    const autoMemPath = getAutoMemPath()
    const autoMemDirCmp = toComparable(autoMemPath.replace(/[/\\]+$/, ''))
    const autoMemPathCmp = toComparable(autoMemPath)
    if (
      normalizedCmp === autoMemDirCmp ||
      normalizedCmp.startsWith(autoMemPathCmp)
    ) {
      return true
    }
  }

  const configDirCmp = toComparable(getClaudeConfigHomeDir())
  const memoryBaseCmp = toComparable(getMemoryBaseDir())
  const underConfig = normalizedCmp.startsWith(configDirCmp)
  const underMemoryBase = normalizedCmp.startsWith(memoryBaseCmp)

  if (!underConfig && !underMemoryBase) {
    return false
  }
  if (normalizedCmp.includes('/session-memory/')) {
    return true
  }
  if (underConfig && normalizedCmp.includes('/projects/')) {
    return true
  }
  if (isAutoMemoryEnabled() && normalizedCmp.includes('/memory/')) {
    return true
  }
  return false
}
// 目录级判定：不仅看配置文件目录，也看记忆基目录，并处理自定义记忆目录覆盖；
// 对自动记忆目录、团队记忆目录以及会话/项目目录分别做前缀匹配。

/**
 * Check if a shell command string (Bash or PowerShell) targets memory files
 * by extracting absolute path tokens and checking them against memory
 * detection functions. Used for Bash/PowerShell grep/search commands in the
 * collapse logic.
 */
export function isShellCommandTargetingMemory(command: string): boolean {
  const configDir = getClaudeConfigHomeDir()
  const memoryBase = getMemoryBaseDir()
  const autoMemDir = isAutoMemoryEnabled()
    ? getAutoMemPath().replace(/[/\\]+$/, '')
    : ''

  // Quick check: does the command mention the config, memory base, or
  // auto-mem directory? Compare in forward-slash form (PowerShell on Windows
  // may use either separator while configDir uses the platform-native one).
  // On Windows also check the MinGW form (/c/...) since BashTool runs under
  // Git Bash which emits that encoding. On Linux/Mac, configDir is already
  // posix so only one form to check — and crucially, windowsPathToPosixPath
  // is NOT called, so Linux paths like /m/foo aren't misinterpreted as MinGW.
  const commandCmp = toComparable(command)
  const dirs = [configDir, memoryBase, autoMemDir].filter(Boolean)
  const matchesAnyDir = dirs.some(d => {
    if (commandCmp.includes(toComparable(d))) return true
    if (IS_WINDOWS) {
      // BashTool on Windows (Git Bash) emits /c/Users/... — check MinGW form too
      return commandCmp.includes(windowsPathToPosixPath(d).toLowerCase())
    }
    return false
  })
  if (!matchesAnyDir) {
    return false
  }

  // Extract absolute path-like tokens. Matches Unix absolute paths (/foo/bar),
  // Windows drive-letter paths (C:\foo, C:/foo), and MinGW paths (/c/foo —
  // they're /-prefixed so the regex already captures them). Bare backslash
  // tokens (\foo) are intentionally excluded — they appear in regex/grep
  // patterns and would cause false-positive memory classification after
  // normalization flips backslashes to forward slashes.
  const matches = command.match(/(?:[A-Za-z]:[/\\]|\/)[^\s'"]+/g)
  if (!matches) {
    return false
  }

  for (const match of matches) {
    // Strip trailing shell metacharacters that could be adjacent to a path
    const cleanPath = match.replace(/[,;|&>]+$/, '')
    // On Windows, convert MinGW /c/... → native C:\... at this single
    // point. Downstream predicates (isAutoManagedMemoryFile, isMemoryDirectory,
    // isAutoMemPath, isAgentMemoryPath) then receive native paths and only
    // need toComparable() for matching. On other platforms, paths are already
    // native — no conversion, so /m/foo etc. pass through unmodified.
    const nativePath = IS_WINDOWS
      ? posixPathToWindowsPath(cleanPath)
      : cleanPath
    if (isAutoManagedMemoryFile(nativePath) || isMemoryDirectory(nativePath)) {
      return true
    }
  }

  return false
}
// 命令级判定：从 Bash/PowerShell 命令里抽取绝对路径片段，逐个判断是否属于自动托管记忆文件或记忆目录，
// 用来在折叠逻辑里识别命令是否触碰记忆数据。

// Check if a glob/pattern targets auto-managed memory files only.
// Excludes CLAUDE.md, CLAUDE.local.md, .claude/rules/ (user-managed).
// Used for collapse badge logic where user-managed files should not be
// counted as "memory" operations.
export function isAutoManagedMemoryPattern(pattern: string): boolean {
  if (detectSessionPatternType(pattern) !== null) {
    return true
  }
  if (
    isAutoMemoryEnabled() &&
    (pattern.replace(/\\/g, '/').includes('agent-memory/') ||
      pattern.replace(/\\/g, '/').includes('agent-memory-local/'))
  ) {
    return true
  }
  return false
}
// 模式级判定：只识别自动托管记忆文件对应的 glob 模式，排除用户自管指令文件，用于折叠徽标统计。
