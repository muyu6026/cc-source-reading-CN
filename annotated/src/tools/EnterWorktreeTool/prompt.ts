// getEnterWorktreeToolPrompt：整段工具提示词。
export function getEnterWorktreeToolPrompt(): string {
// 提示词核心就一句：**只在用户明确说出 worktree 时用**。建分支、切分支、修 bug、做功能全部走普通 git 流程——模型最爱把「隔离工作环境」自作主张升级成 worktree，这里用三条 When NOT to Use 把路堵死。
  return `Use this tool ONLY when the user explicitly asks to work in a worktree. This tool creates an isolated git worktree and switches the current session into it.

## When to Use

- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", "create a worktree", "use a worktree")

## When NOT to Use

- The user asks to create a branch, switch branches, or work on a different branch — use git commands instead
- The user asks to fix a bug or work on a feature — use normal git workflow unless they specifically mention worktrees
- Never use this tool unless the user explicitly mentions "worktree"

## Requirements

- Must be in a git repository, OR have WorktreeCreate/WorktreeRemove hooks configured in settings.json
- Must not already be in a worktree

## Behavior

- In a git repository: creates a new git worktree inside \`.claude/worktrees/\` with a new branch based on HEAD
- Outside a git repository: delegates to WorktreeCreate/WorktreeRemove hooks for VCS-agnostic isolation
- Switches the session's working directory to the new worktree
- Use ExitWorktree to leave the worktree mid-session (keep or remove). On session exit, if still in the worktree, the user will be prompted to keep or remove it

## Parameters

- \`name\` (optional): A name for the worktree. If not provided, a random name is generated.
`
// 末尾交代 name 参数与两种落盘方式：git 仓库内建在 .claude/worktrees/ 下（基于 HEAD 开新分支）；仓库外则委托 WorktreeCreate/WorktreeRemove hooks 做 VCS 无关的隔离——非 git 项目也能用同一套工具语义。
}
