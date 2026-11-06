import type { Command } from '../commands.js'
// 依赖：命令类型、归属文案、把提示词里的 shell 指令真正跑起来的执行器、隐身模式开关。
import { getAttributionTexts } from '../utils/attribution.js'
import { executeShellCommandsInPrompt } from '../utils/promptShellExecution.js'
import { getUndercoverInstructions, isUndercover } from '../utils/undercover.js'

const ALLOWED_TOOLS = [
// 白名单：只允许 git add / status / commit 三条，提交命令的权限收得很死。
  'Bash(git add:*)',
  'Bash(git status:*)',
  'Bash(git commit:*)',
]

function getPromptContent(): string {
  const { commit: commitAttribution } = getAttributionTexts()

  let prefix = ''
  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
    prefix = getUndercoverInstructions() + '\n'
  }

  return `${prefix}## Context

- Current git status: !\`git status\`
- Current git diff (staged and unstaged changes): !\`git diff HEAD\`
- Current branch: !\`git branch --show-current\`
- Recent commits: !\`git log --oneline -10\`

## Git Safety Protocol

- NEVER update the git config
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- CRITICAL: ALWAYS create NEW commits. NEVER use git commit --amend, unless the user explicitly requests it
- Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported

## Your task

Based on the above changes, create a single git commit:

1. Analyze all staged changes and draft a commit message:
   - Look at the recent commits above to follow this repository's commit message style
   - Summarize the nature of the changes (new feature, enhancement, bug fix, refactoring, test, docs, etc.)
   - Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.)
   - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"

2. Stage relevant files and create the commit using HEREDOC syntax:
\`\`\`
git commit -m "$(cat <<'EOF'
Commit message here.${commitAttribution ? `\n\n${commitAttribution}` : ''}
EOF
)"
\`\`\`

You have the capability to call multiple tools in a single response. Stage and create the commit using a single message. Do not use any other tools or do anything else. Do not send any other text or messages besides these tool calls.`
// getPromptContent：拼出一段给模型的提交提示词，含 git 状态、diff、分支、近期提交。
// git 安全协议：明文禁止改配置、跳 hook、amend、提交疑似密钥文件、空提交、交互式命令。
}
// 提示词收尾：要求用 HEREDOC 写提交信息，并强调只做这一件事、不夹带其它工具调用。

const command = {
// 命令对象：type 为 prompt，内置命令，进度文案 creating commit。
  type: 'prompt',
  name: 'commit',
  description: 'Create a git commit',
  allowedTools: ALLOWED_TOOLS,
  contentLength: 0, // Dynamic content
// contentLength 为 0：内容由 getPromptForCommand 动态生成，这里只是占位。
  progressMessage: 'creating commit',
  source: 'builtin',
  async getPromptForCommand(_args, context) {
    const promptContent = getPromptContent()
    const finalContent = await executeShellCommandsInPrompt(
      promptContent,
      {
        ...context,
        getAppState() {
          const appState = context.getAppState()
          return {
            ...appState,
            toolPermissionContext: {
              ...appState.toolPermissionContext,
              alwaysAllowRules: {
                ...appState.toolPermissionContext.alwaysAllowRules,
                command: ALLOWED_TOOLS,
              },
            },
          }
        },
      },
      '/commit',
    )

    return [{ type: 'text', text: finalContent }]
  },
// getPromptForCommand：把提示词里的感叹号反引号指令执行掉，再注入 alwaysAllow 规则放行白名单。
} satisfies Command
// satisfies Command：用类型谓词保证这个对象形状完全符合 Command 契约。

export default command
// 默认导出：其它地方 import 这个 command 即可挂到 /commit。
