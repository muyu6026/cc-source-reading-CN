/**
 * Detects potentially destructive bash commands and returns a warning string
 * for display in the permission dialog. This is purely informational — it
 * doesn't affect permission logic or auto-approval.
 */
// 破坏性命令警告表。**纯展示**：只往权限弹窗里加一行提示，不影响权限判定和自动放行——判定由 pathValidation/bashSecurity 等负责。

type DestructivePattern = {
  pattern: RegExp
  warning: string
}

const DESTRUCTIVE_PATTERNS: DestructivePattern[] = [
// DESTRUCTIVE_PATTERNS 三组：git 数据丢失、git 安全绕过、文件删除、数据库、基础设施。
  // Git — data loss / hard to reverse
  {
// git reset --hard：可能丢弃未提交改动。
    pattern: /\bgit\s+reset\s+--hard\b/,
    warning: 'Note: may discard uncommitted changes',
  },
  {
    pattern: /\bgit\s+push\b[^;&|\n]*[ \t](--force|--force-with-lease|-f)\b/,
// git push --force / --force-with-lease / -f：[^;&|\n]* 把匹配限制在同一条命令内（不跨管道/分号/换行）。
    warning: 'Note: may overwrite remote history',
  },
  {
    pattern:
// git clean -f 的负向前查：带 -n/--dry-run 的 clean 是演习不破坏，不算。
      /\bgit\s+clean\b(?![^;&|\n]*(?:-[a-zA-Z]*n|--dry-run))[^;&|\n]*-[a-zA-Z]*f/,
    warning: 'Note: may permanently delete untracked files',
  },
  {
    pattern: /\bgit\s+checkout\s+(--\s+)?\.[ \t]*($|[;&|\n])/,
// git checkout . / git restore .：丢弃全部工作区改动（root 形式，句点后必须是命令结尾或分隔符）。
    warning: 'Note: may discard all working tree changes',
  },
  {
    pattern: /\bgit\s+restore\s+(--\s+)?\.[ \t]*($|[;&|\n])/,
    warning: 'Note: may discard all working tree changes',
  },
  {
    pattern: /\bgit\s+stash[ \t]+(drop|clear)\b/,
// git stash drop/clear：暂存记录永久删除。
    warning: 'Note: may permanently remove stashed changes',
  },
  {
    pattern:
// git branch -D：强制删分支（未合并的提交会丢）。-D 后面必须跟空白（防止误伤 -DD 之类）。
      /\bgit\s+branch\s+(-D[ \t]|--delete\s+--force|--force\s+--delete)\b/,
    warning: 'Note: may force-delete a branch',
  },

  // Git — safety bypass
  {
// 安全绕过组：--no-verify 跳过 hook；--amend 重写最后一条 commit。
    pattern: /\bgit\s+(commit|push|merge)\b[^;&|\n]*--no-verify\b/,
    warning: 'Note: may skip safety hooks',
  },
  {
    pattern: /\bgit\s+commit\b[^;&|\n]*--amend\b/,
    warning: 'Note: may rewrite the last commit',
  },

  // File deletion (dangerous paths already handled by checkDangerousRemovalPaths)
// rm 组注释：危险路径的删除已由 checkDangerousRemovalPaths 管，这里只做「递归/强制」特征提示。两个正则分别覆盖 -rf 和 -fr 的排列。
  {
    pattern:
      /(^|[;&|\n]\s*)rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f|(^|[;&|\n]\s*)rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR]/,
    warning: 'Note: may recursively force-remove files',
  },
  {
// 纯 -r（无 -f）也提示——递归删除本身就是大动作。
    pattern: /(^|[;&|\n]\s*)rm\s+-[a-zA-Z]*[rR]/,
    warning: 'Note: may recursively remove files',
  },
  {
    pattern: /(^|[;&|\n]\s*)rm\s+-[a-zA-Z]*f/,
    warning: 'Note: may force-remove files',
  },

  // Database
  {
// SQL：DROP/TRUNCATE TABLE|DATABASE|SCHEMA；DELETE FROM 表名后跟结束符（防误伤 "DELETE FROM users_backup" 之类子串匹配——虽然 \w+ 已经兜了一层）。
    pattern: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i,
    warning: 'Note: may drop or truncate database objects',
  },
  {
    pattern: /\bDELETE\s+FROM\s+\w+[ \t]*(;|"|'|\n|$)/i,
    warning: 'Note: may delete all rows from a database table',
  },

  // Infrastructure
// 基础设施：kubectl delete、terraform destroy。
  {
    pattern: /\bkubectl\s+delete\b/,
    warning: 'Note: may delete Kubernetes resources',
  },
  {
    pattern: /\bterraform\s+destroy\b/,
    warning: 'Note: may destroy Terraform infrastructure',
  },
]

/**
 * Checks if a bash command matches known destructive patterns.
 * Returns a human-readable warning string, or null if no destructive pattern is detected.
 */
// getDestructiveCommandWarning 返回第一条命中的警告（顺序即优先级）。
export function getDestructiveCommandWarning(command: string): string | null {
  for (const { pattern, warning } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return warning
    }
  }
  return null
}
