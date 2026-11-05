import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { saveGlobalConfig } from 'src/utils/config.js'
import {
  CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT,
  PR_BODY,
  PR_TITLE,
  WORKFLOW_CONTENT,
} from '../../constants/github-app.js'
import { openBrowser } from '../../utils/browser.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { logError } from '../../utils/log.js'
import type { Workflow } from './types.js'

// 写单个工作流文件：先探是否已存在，再把密钥名替换进模板，最后走内容接口提交
async function createWorkflowFile(
  repoName: string,
  branchName: string,
  workflowPath: string,
  workflowContent: string,
  secretName: string,
  message: string,
  context?: {
    useCurrentRepo?: boolean
    workflowExists?: boolean
    secretExists?: boolean
  },
): Promise<void> {
  // Check if workflow file already exists
// 先查文件拿版本号：这个接口没有幂等写法，存在与否决定是新建还是更新
  const checkFileResult = await execFileNoThrow('gh', [
    'api',
    `repos/${repoName}/contents/${workflowPath}`,
    '--jq',
    '.sha',
  ])

  let fileSha: string | null = null
// 查到版本号就说明文件已在，后续提交必须带上它，否则服务端会判冲突
  if (checkFileResult.code === 0) {
    fileSha = checkFileResult.stdout.trim()
  }

// 模板原文只在两种密钥名不同时改写：默认名不用动，OAuth 令牌则要换参数名
  let content = workflowContent
// OAuth 令牌用的是另一个入参名，只换密钥占位符会让工作流读到空值
  if (secretName === 'CLAUDE_CODE_OAUTH_TOKEN') {
    // For OAuth tokens, use the claude_code_oauth_token parameter
    content = workflowContent.replace(
      /anthropic_api_key: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/g,
      `claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`,
    )
  } else if (secretName !== 'ANTHROPIC_API_KEY') {
    // For other custom secret names, keep using anthropic_api_key parameter
    content = workflowContent.replace(
      /anthropic_api_key: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/g,
      `anthropic_api_key: \${{ secrets.${secretName} }}`,
    )
  }
// 内容接口只收 base64，直接传原文会被当成非法编码
  const base64Content = Buffer.from(content).toString('base64')

// 参数用数组拼而不是字符串拼接：提交信息里可能带空格与引号
  const apiParams = [
    'api',
    '--method',
    'PUT',
    `repos/${repoName}/contents/${workflowPath}`,
    '-f',
// 提交信息自己加引号：底层工具会把空格后的部分当独立参数，不加引号会被截断
    `message=${fileSha ? `"Update ${message}"` : `"${message}"`}`,
    '-f',
    `content=${base64Content}`,
    '-f',
    `branch=${branchName}`,
  ]

// 有版本号才追加版本参数：新建时带上它反而会被拒
  if (fileSha) {
    apiParams.push('-f', `sha=${fileSha}`)
  }

  const createFileResult = await execFileNoThrow('gh', apiParams)
  if (createFileResult.code !== 0) {
// 冲突与普通失败分开处置：前者是可预期的重复安装，要给出可执行的下一步
    if (
      createFileResult.stderr.includes('422') &&
      createFileResult.stderr.includes('sha')
    ) {
// 事件里带原因与退出码，还带上调用方传进来的上下文，便于区分是哪一次安装
      logEvent('tengu_setup_github_actions_failed', {
        reason:
          'failed_to_create_workflow_file' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        exit_code: createFileResult.code,
        ...context,
      })
      throw new Error(
        `Failed to create workflow file ${workflowPath}: A Claude workflow file already exists in this repository. Please remove it first or update it manually.`,
      )
    }

    logEvent('tengu_setup_github_actions_failed', {
      reason:
        'failed_to_create_workflow_file' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      exit_code: createFileResult.code,
      ...context,
    })

// 错误里附三条最常见的自救路径：权限、管理员身份、手动配置入口
    const helpText =
      '\n\nNeed help? Common issues:\n' +
      '· Permission denied → Run: gh auth refresh -h github.com -s repo,workflow\n' +
      '· Not authorized → Ensure you have admin access to the repository\n' +
      '· For manual setup → Visit: https://github.com/anthropics/claude-code-action'

    throw new Error(
      `Failed to create workflow file ${workflowPath}: ${createFileResult.stderr}${helpText}`,
    )
  }
}

// 主流程：查仓库、取默认分支与提交、建分支、写工作流、设密钥、开对比页
export async function setupGitHubActions(
  repoName: string,
  apiKeyOrOAuthToken: string | null,
  secretName: string,
  updateProgress: () => void,
  skipWorkflow = false,
  selectedWorkflows: Workflow[],
  authType: 'api_key' | 'oauth_token',
  context?: {
    useCurrentRepo?: boolean
    workflowExists?: boolean
    secretExists?: boolean
  },
) {
  try {
// 开始时就把选择项全记下来：成功与失败共用同一组上下文，事后能对齐
    logEvent('tengu_setup_github_actions_started', {
      skip_workflow: skipWorkflow,
      has_api_key: !!apiKeyOrOAuthToken,
      using_default_secret_name: secretName === 'ANTHROPIC_API_KEY',
      selected_claude_workflow: selectedWorkflows.includes('claude'),
      selected_claude_review_workflow:
        selectedWorkflows.includes('claude-review'),
      ...context,
    })

    // Check if repository exists
// 先确认仓库可见：后面每一步都要仓库名，权限不足在这里就会暴露
    const repoCheckResult = await execFileNoThrow('gh', [
      'api',
      `repos/${repoName}`,
      '--jq',
      '.id',
    ])
    if (repoCheckResult.code !== 0) {
      logEvent('tengu_setup_github_actions_failed', {
        reason:
          'repo_not_found' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        exit_code: repoCheckResult.code,
        ...context,
      })
      throw new Error(
        `Failed to access repository ${repoName}: ${repoCheckResult.stderr}`,
      )
    }

    // Get default branch
// 默认分支单独查一次：提交接口要的是分支上的引用，不是仓库的默认值
    const defaultBranchResult = await execFileNoThrow('gh', [
      'api',
      `repos/${repoName}`,
      '--jq',
      '.default_branch',
    ])
    if (defaultBranchResult.code !== 0) {
      logEvent('tengu_setup_github_actions_failed', {
        reason:
          'failed_to_get_default_branch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        exit_code: defaultBranchResult.code,
        ...context,
      })
      throw new Error(
        `Failed to get default branch: ${defaultBranchResult.stderr}`,
      )
    }
    const defaultBranch = defaultBranchResult.stdout.trim()

    // Get SHA of default branch
// 建分支要基于当前提交：直接按分支名建会从默认分支头开始，丢掉用户的新提交
    const shaResult = await execFileNoThrow('gh', [
      'api',
      `repos/${repoName}/git/ref/heads/${defaultBranch}`,
      '--jq',
      '.object.sha',
    ])
    if (shaResult.code !== 0) {
      logEvent('tengu_setup_github_actions_failed', {
        reason:
          'failed_to_get_branch_sha' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        exit_code: shaResult.code,
        ...context,
      })
      throw new Error(`Failed to get branch SHA: ${shaResult.stderr}`)
    }
    const sha = shaResult.stdout.trim()

// 分支名先留空：跳过工作流时整段不建分支，后面的步骤要能判断
    let branchName: string | null = null

// 跳过工作流只设密钥：这种用法是给已有工作流的仓库补凭据
    if (!skipWorkflow) {
      updateProgress()
      // Create new branch
// 分支名带时间戳：同一仓库重复安装不会互相覆盖，也方便用户识别
      branchName = `add-claude-github-actions-${Date.now()}`
      const createBranchResult = await execFileNoThrow('gh', [
        'api',
        '--method',
        'POST',
        `repos/${repoName}/git/refs`,
        '-f',
        `ref=refs/heads/${branchName}`,
        '-f',
        `sha=${sha}`,
      ])
      if (createBranchResult.code !== 0) {
        logEvent('tengu_setup_github_actions_failed', {
          reason:
            'failed_to_create_branch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          exit_code: createBranchResult.code,
          ...context,
        })
        throw new Error(`Failed to create branch: ${createBranchResult.stderr}`)
      }

      updateProgress()
      // Create selected workflow files
// 按用户勾选拼清单：两个工作流各自独立，可以只装一个
      const workflows = []

      if (selectedWorkflows.includes('claude')) {
        workflows.push({
          path: '.github/workflows/claude.yml',
          content: WORKFLOW_CONTENT,
          message: 'Claude PR Assistant workflow',
        })
      }

      if (selectedWorkflows.includes('claude-review')) {
        workflows.push({
          path: '.github/workflows/claude-code-review.yml',
          content: CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT,
          message: 'Claude Code Review workflow',
        })
      }

// 逐个写入，任一失败整批中止：半个工作流比没有更难看懂
      for (const workflow of workflows) {
        await createWorkflowFile(
          repoName,
          branchName,
          workflow.path,
          workflow.content,
          secretName,
          workflow.message,
          context,
        )
      }
    }

    updateProgress()
    // Set the API key as a secret if provided
// 密钥在分支建好之后才设：仓库级密钥与分支无关，放后面失败时至少分支还能复用
    if (apiKeyOrOAuthToken) {
      const setSecretResult = await execFileNoThrow('gh', [
        'secret',
        'set',
        secretName,
        '--body',
        apiKeyOrOAuthToken,
        '--repo',
        repoName,
      ])
      if (setSecretResult.code !== 0) {
        logEvent('tengu_setup_github_actions_failed', {
          reason:
            'failed_to_set_api_key_secret' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          exit_code: setSecretResult.code,
          ...context,
        })

// 设密钥失败的提示比建文件少一条：这一步不需要工作流写权限
        const helpText =
          '\n\nNeed help? Common issues:\n' +
          '· Permission denied → Run: gh auth refresh -h github.com -s repo\n' +
          '· Not authorized → Ensure you have admin access to the repository\n' +
          '· For manual setup → Visit: https://github.com/anthropics/claude-code-action'

        throw new Error(
          `Failed to set API key secret: ${setSecretResult.stderr || 'Unknown error'}${helpText}`,
        )
      }
    }

// 不直接建拉取请求而是开对比页：生成提交信息与说明交给用户在网页上确认
    if (!skipWorkflow && branchName) {
      updateProgress()
      // Create PR template URL instead of creating PR directly
// 对比地址带预填标题与正文，用户点一下就能建，省掉手工抄写
      const compareUrl = `https://github.com/${repoName}/compare/${defaultBranch}...${branchName}?quick_pull=1&title=${encodeURIComponent(PR_TITLE)}&body=${encodeURIComponent(PR_BODY)}`

      await openBrowser(compareUrl)
    }

    logEvent('tengu_setup_github_actions_completed', {
      skip_workflow: skipWorkflow,
      has_api_key: !!apiKeyOrOAuthToken,
      auth_type:
        authType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      using_default_secret_name: secretName === 'ANTHROPIC_API_KEY',
      selected_claude_workflow: selectedWorkflows.includes('claude'),
      selected_claude_review_workflow:
        selectedWorkflows.includes('claude-review'),
      ...context,
    })
// 计数只在成功后自增：它用于提示用户别再重复安装，失败也算就失真了
    saveGlobalConfig(current => ({
      ...current,
      githubActionSetupCount: (current.githubActionSetupCount ?? 0) + 1,
    }))
  } catch (error) {
    if (
      !error ||
      !(error instanceof Error) ||
      !error.message.includes('Failed to')
    ) {
// 只对不认识的失败记兜底原因：带固定前缀的错误已在各步骤里单独上报过
      logEvent('tengu_setup_github_actions_failed', {
        reason:
          'unexpected_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...context,
      })
    }
// 原始错误照旧写日志再抛，调用方还要靠它决定展示什么
    if (error instanceof Error) {
      logError(error)
    }
    throw error
  }
}
