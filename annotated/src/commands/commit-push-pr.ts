import type { Command } from '../commands.js'
import {
  getAttributionTexts,
  getEnhancedPRAttribution,
} from '../utils/attribution.js'
import { getDefaultBranch } from '../utils/git.js'
import { executeShellCommandsInPrompt } from '../utils/promptShellExecution.js'
import { getUndercoverInstructions, isUndercover } from '../utils/undercover.js'

// 放行清单只留提交推送建单需要的命令，且各自限定到子命令前缀
const ALLOWED_TOOLS = [
  'Bash(git checkout --branch:*)',
  'Bash(git checkout -b:*)',
  'Bash(git add:*)',
  'Bash(git status:*)',
  'Bash(git push:*)',
  'Bash(git commit:*)',
  'Bash(gh pr create:*)',
  'Bash(gh pr edit:*)',
  'Bash(gh pr view:*)',
  'Bash(gh pr merge:*)',
// 搜索工具与两个 Slack 发消息工具在列：第五步要按项目约定决定是否通知
  'ToolSearch',
  'mcp__slack__send_message',
  'mcp__claude_ai_Slack__slack_send_message',
]

// 提示词构造：把现场上下文、安全约束与建单步骤拼成一份可直接执行的文本
function getPromptContent(
  defaultBranch: string,
  prAttribution?: string,
): string {
// 署名文案由配置决定，提交与合并请求各取一份，后者可被调用方覆盖
  const { commit: commitAttribution, pr: defaultPrAttribution } =
    getAttributionTexts()
  // Use provided PR attribution or fall back to default
  const effectivePrAttribution = prAttribution ?? defaultPrAttribution
// 用户名两个来源：安全用户名优先，为空退回系统用户
  const safeUser = process.env.SAFEUSER || ''
  const username = process.env.USER || ''

// 三项默认附加——评审人、变更日志段、Slack 步——在内部隐身模式下会被整段清掉
  let prefix = ''
  let reviewerArg = ' and `--reviewer anthropics/claude-code`'
  let addReviewerArg = ' (and add `--add-reviewer anthropics/claude-code`)'
  let changelogSection = `

## Changelog
<!-- CHANGELOG:START -->
[If this PR contains user-facing changes, add a changelog entry here. Otherwise, remove this section.]
<!-- CHANGELOG:END -->`
  let slackStep = `

5. After creating/updating the PR, check if the user's CLAUDE.md mentions posting to Slack channels. If it does, use ToolSearch to search for "slack send message" tools. If ToolSearch finds a Slack tool, ask the user if they'd like you to post the PR URL to the relevant Slack channel. Only post if the user confirms. If ToolSearch returns no results or errors, skip this step silently—do not mention the failure, do not attempt workarounds, and do not try alternative approaches.`
// 隐身模式换一套指令并撤掉评审人、变更日志与 Slack 三步：对外提交不能带内部痕迹
  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
    prefix = getUndercoverInstructions() + '\n'
    reviewerArg = ''
    addReviewerArg = ''
    changelogSection = ''
    slackStep = ''
  }

// 正文分节：现场上下文（六条命令直接取当前输出）→ 安全约束 → 任务步骤 → 返回链接
  return `${prefix}## Context

- \`SAFEUSER\`: ${safeUser}
- \`whoami\`: ${username}
- \`git status\`: !\`git status\`
- \`git diff HEAD\`: !\`git diff HEAD\`
- \`git branch --show-current\`: !\`git branch --show-current\`
- \`git diff ${defaultBranch}...HEAD\`: !\`git diff ${defaultBranch}...HEAD\`
- \`gh pr view --json number 2>/dev/null || true\`: !\`gh pr view --json number 2>/dev/null || true\`

## Git Safety Protocol

- NEVER update the git config
- NEVER run destructive/irreversible git commands (like push --force, hard reset, etc) unless the user explicitly requests them
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- NEVER run force push to main/master, warn the user if they request it
- Do not commit files that likely contain secrets (.env, credentials.json, etc)
- Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported

## Your task

Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request from the git diff ${defaultBranch}...HEAD output above).

Based on the above changes:
1. Create a new branch if on ${defaultBranch} (use SAFEUSER from context above for the branch name prefix, falling back to whoami if SAFEUSER is empty, e.g., \`username/feature-name\`)
2. Create a single commit with an appropriate message using heredoc syntax${commitAttribution ? `, ending with the attribution text shown in the example below` : ''}:
\`\`\`
git commit -m "$(cat <<'EOF'
Commit message here.${commitAttribution ? `\n\n${commitAttribution}` : ''}
EOF
)"
\`\`\`
3. Push the branch to origin
4. If a PR already exists for this branch (check the gh pr view output above), update the PR title and body using \`gh pr edit\` to reflect the current diff${addReviewerArg}. Otherwise, create a pull request using \`gh pr create\` with heredoc syntax for the body${reviewerArg}.
   - IMPORTANT: Keep PR titles short (under 70 characters). Use the body for details.
\`\`\`
gh pr create --title "Short, descriptive title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Bulleted markdown checklist of TODOs for testing the pull request...]${changelogSection}${effectivePrAttribution ? `\n\n${effectivePrAttribution}` : ''}
EOF
)"
\`\`\`

You have the capability to call multiple tools in a single response. You MUST do all of the above in a single message.${slackStep}

Return the PR URL when you're done, so the user can see it.`
}

// 命令定义：内容长度取默认分支下的估算值，只用于界面提示
const command = {
  type: 'prompt',
  name: 'commit-push-pr',
  description: 'Commit, push, and open a PR',
  allowedTools: ALLOWED_TOOLS,
// 长度是取值器不是字段：提示词依赖分支名，只能算不能存
  get contentLength() {
    // Use 'main' as estimate for content length calculation
    return getPromptContent('main').length
  },
  progressMessage: 'creating commit and PR',
  source: 'builtin',
// 取提示词：默认分支与署名并行取，两者互不阻塞
  async getPromptForCommand(args, context) {
    // Get default branch and enhanced PR attribution
    const [defaultBranch, prAttribution] = await Promise.all([
      getDefaultBranch(),
      getEnhancedPRAttribution(context.getAppState),
    ])
    let promptContent = getPromptContent(defaultBranch, prAttribution)

    // Append user instructions if args provided
// 用户附加指令追加在末尾：位置靠后，与正文的先后关系也更直观
    const trimmedArgs = args?.trim()
    if (trimmedArgs) {
      promptContent += `\n\n## Additional instructions from user\n\n${trimmedArgs}`
    }

// 展开嵌入命令前先给应用状态补一条放行规则，让正文里的提交与建单命令免确认
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
// 命令名传给执行器，日志里能看出是哪条命令展开出来的
      '/commit-push-pr',
    )

    return [{ type: 'text', text: finalContent }]
  },
} satisfies Command

export default command
