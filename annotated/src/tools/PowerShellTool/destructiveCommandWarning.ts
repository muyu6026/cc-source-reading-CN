/**
 * Detects potentially destructive PowerShell commands and returns a warning
 * string for display in the permission dialog. This is purely informational
 * -- it doesn't affect permission logic or auto-approval.
 */
// 纯信息层：只产出权限对话框里的警告文案，不参与权限判定与自动批准——「让用户多看一眼」与「拦下来」是两套独立系统。

type DestructivePattern = {
  pattern: RegExp
  warning: string
}

const DESTRUCTIVE_PATTERNS: DestructivePattern[] = [
  // Remove-Item with -Recurse and/or -Force (and common aliases)
  // Anchored to statement start (^, |, ;, &, newline, {, () so `git rm --force`
  // doesn't match — \b would match `rm` after any word boundary. The `{(`
  // chars catch scriptblock/group bodies: `{ rm -Force ./x }`. The stopper
  // adds only `}` (NOT `)`) — `}` ends a block so flags after it belong to a
  // different statement (`if {rm} else {... -Force}`), but `)` closes a path
  // grouping and flags after it are still this command's flags:
  // `Remove-Item (Join-Path $r "tmp") -Recurse -Force` must still warn.
  {
    pattern:
      /(?:^|[|;&\n({])\s*(Remove-Item|rm|del|rd|rmdir|ri)\b[^|;&\n}]*-Recurse\b[^|;&\n}]*-Force\b/i,
    warning: 'Note: may recursively force-remove files',
// 锚定到语句起始（行首、管道、分号、换行、花括号、圆括号）防止 git rm --force 里的 rm 误匹配。停止符只含花括号不含圆括号：花括号结束代码块、后面的参数属于别的语句；圆括号是路径分组闭合、后面的参数仍是本命令的——Remove-Item (Join-Path ...) -Recurse -Force 必须仍然告警。
  },
  {
    pattern:
      /(?:^|[|;&\n({])\s*(Remove-Item|rm|del|rd|rmdir|ri)\b[^|;&\n}]*-Force\b[^|;&\n}]*-Recurse\b/i,
    warning: 'Note: may recursively force-remove files',
  },
  {
    pattern:
      /(?:^|[|;&\n({])\s*(Remove-Item|rm|del|rd|rmdir|ri)\b[^|;&\n}]*-Recurse\b/i,
    warning: 'Note: may recursively remove files',
  },
  {
    pattern:
      /(?:^|[|;&\n({])\s*(Remove-Item|rm|del|rd|rmdir|ri)\b[^|;&\n}]*-Force\b/i,
    warning: 'Note: may force-remove files',
  },
// -Recurse 与 -Force 各自单独出现也告警（两条独立正则），加上两种顺序的组合共四条，覆盖参数排列的全部情况。

  // Clear-Content on broad paths
  {
    pattern: /\bClear-Content\b[^|;&\n]*\*/i,
    warning: 'Note: may clear content of multiple files',
  },

  // Format-Volume and Clear-Disk
  {
    pattern: /\bFormat-Volume\b/i,
    warning: 'Note: may format a disk volume',
  },
  {
    pattern: /\bClear-Disk\b/i,
    warning: 'Note: may clear a disk',
  },

  // Git destructive operations (same as BashTool)
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    warning: 'Note: may discard uncommitted changes',
  },
  {
    pattern: /\bgit\s+push\b[^|;&\n]*\s+(--force|--force-with-lease|-f)\b/i,
    warning: 'Note: may overwrite remote history',
  },
  {
    pattern:
      /\bgit\s+clean\b(?![^|;&\n]*(?:-[a-zA-Z]*n|--dry-run))[^|;&\n]*-[a-zA-Z]*f/i,
    warning: 'Note: may permanently delete untracked files',
  },
// git clean 用负向前瞻排除 -n 与 --dry-run——演练模式不删东西，不告警。
  {
    pattern: /\bgit\s+stash\s+(drop|clear)\b/i,
    warning: 'Note: may permanently remove stashed changes',
  },

  // Database operations
  {
    pattern: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i,
    warning: 'Note: may drop or truncate database objects',
  },
// DROP/TRUNCATE 数据库对象不分 SQL 方言统一告警。

  // System operations
  {
    pattern: /\bStop-Computer\b/i,
    warning: 'Note: will shut down the computer',
  },
  {
    pattern: /\bRestart-Computer\b/i,
    warning: 'Note: will restart the computer',
  },
  {
    pattern: /\bClear-RecycleBin\b/i,
    warning: 'Note: permanently deletes recycled files',
  },
]

/**
 * Checks if a PowerShell command matches known destructive patterns.
 * Returns a human-readable warning string, or null if no destructive pattern is detected.
 */
export function getDestructiveCommandWarning(command: string): string | null {
  for (const { pattern, warning } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return warning
    }
  }
  return null
}
// 逐条顺序匹配、命中即返回第一条警告——一个命令只显示一条提示，不做权重排序。
