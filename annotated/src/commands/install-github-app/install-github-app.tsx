// 用这个执行器是因为要跑带管道的复合命令，下面两条 gh 检查都需要走 shell
import { execa } from 'execa';
import React, { useCallback, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { WorkflowMultiselectDialog } from '../../components/WorkflowMultiselectDialog.js';
import { GITHUB_ACTION_SETUP_DOCS_URL } from '../../constants/github-app.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box } from '../../ink.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getAnthropicApiKey, isAnthropicAuthEnabled } from '../../utils/auth.js';
import { openBrowser } from '../../utils/browser.js';
import { execFileNoThrow } from '../../utils/execFileNoThrow.js';
import { getGithubRepo } from '../../utils/git.js';
import { plural } from '../../utils/stringUtils.js';
import { ApiKeyStep } from './ApiKeyStep.js';
import { CheckExistingSecretStep } from './CheckExistingSecretStep.js';
import { CheckGitHubStep } from './CheckGitHubStep.js';
import { ChooseRepoStep } from './ChooseRepoStep.js';
import { CreatingStep } from './CreatingStep.js';
import { ErrorStep } from './ErrorStep.js';
import { ExistingWorkflowStep } from './ExistingWorkflowStep.js';
import { InstallAppStep } from './InstallAppStep.js';
import { OAuthFlowStep } from './OAuthFlowStep.js';
import { SuccessStep } from './SuccessStep.js';
import { setupGitHubActions } from './setupGitHubActions.js';
import type { State, Warning, Workflow } from './types.js';
import { WarningsStep } from './WarningsStep.js';
// 初始状态是一张扁平表：十几个字段覆盖整条流程，步骤名是唯一的状态机变量
const INITIAL_STATE: State = {
  step: 'check-gh',
  selectedRepoName: '',
  currentRepo: '',
  useCurrentRepo: false,
  // Default to false, will be set to true if repo detected
  apiKeyOrOAuthToken: '',
  useExistingKey: true,
  currentWorkflowInstallStep: 0,
  warnings: [],
  secretExists: false,
  secretName: 'ANTHROPIC_API_KEY',
  useExistingSecret: true,
  workflowExists: false,
// 默认勾选两个工作流，用户可以只按回车接受
  selectedWorkflows: ['claude', 'claude-review'] as Workflow[],
  selectedApiKeyOption: 'new' as 'existing' | 'new' | 'oauth',
  authType: 'api_key'
};
function InstallGitHubApp(props: {
  onDone: (message: string) => void;
}): React.ReactNode {
// 本地是否已有密钥只读一次，所以放进惰性初始化，而不是每次渲染都去读
  const [existingApiKey] = useState(() => getAnthropicApiKey());
  const [state, setState] = useState({
    ...INITIAL_STATE,
    useExistingKey: !!existingApiKey,
// 初始化时按本地条件改写两个字段：有本地密钥就默认沿用，没有则看是否支持登录授权来决定新建还是走授权流程
    selectedApiKeyOption: (existingApiKey ? 'existing' : isAnthropicAuthEnabled() ? 'oauth' : 'new') as 'existing' | 'new' | 'oauth'
  });
// 整个流程里中断键都能退出，不必每个步骤各写一份
  useExitOnCtrlCDWithKeybindings();
  React.useEffect(() => {
    logEvent('tengu_install_github_app_started', {});
  }, []);
// 第一步检查把三件事一次查完：命令行工具是否存在、是否已登录、权限是否够用，结果汇总成警告列表
  const checkGitHubCLI = useCallback(async () => {
    const warnings: Warning[] = [];

    // Check if gh is installed
// 关掉失败即抛：命令出错时不要异常，要拿退出码自己判断
    const ghVersionResult = await execa('gh --version', {
      shell: true,
      reject: false
    });
// 没装只记警告不中断：后面仍然可能靠手动步骤完成
    if (ghVersionResult.exitCode !== 0) {
      warnings.push({
        title: 'GitHub CLI not found',
        message: 'GitHub CLI (gh) does not appear to be installed or accessible.',
        instructions: ['Install GitHub CLI from https://cli.github.com/', 'macOS: brew install gh', 'Windows: winget install --id GitHub.cli', 'Linux: See installation instructions at https://github.com/cli/cli#installation']
      });
    }

    // Check auth status
// 登录状态检查带上全部账号参数，让输出里包含每个账号的权限信息
    const authResult = await execa('gh auth status -a', {
      shell: true,
      reject: false
    });
    if (authResult.exitCode !== 0) {
      warnings.push({
        title: 'GitHub CLI not authenticated',
        message: 'GitHub CLI does not appear to be authenticated.',
        instructions: ['Run: gh auth login', 'Follow the prompts to authenticate with GitHub', 'Or set up authentication using environment variables or other methods']
      });
    } else {
      // Check if required scopes are present in the Token scopes line
// 从输出里抓权限那一行；抓不到就不做后续判断，避免误报
      const tokenScopesMatch = authResult.stdout.match(/Token scopes:.*$/m);
      if (tokenScopesMatch) {
        const scopes = tokenScopesMatch[0];
        const missingScopes: string[] = [];
        if (!scopes.includes('repo')) {
          missingScopes.push('repo');
        }
        if (!scopes.includes('workflow')) {
          missingScopes.push('workflow');
        }
// 缺权限直接进错误页并给出可复制的修复命令：这类问题用户自己能解决，不该混在警告里让人猜
        if (missingScopes.length > 0) {
          // Missing required scopes - exit immediately
          setState(prev => ({
            ...prev,
            step: 'error',
            error: `GitHub CLI is missing required permissions: ${missingScopes.join(', ')}.`,
            errorReason: 'Missing required scopes',
            errorInstructions: [`Your GitHub CLI authentication is missing the "${missingScopes.join('" and "')}" ${plural(missingScopes.length, 'scope')} needed to manage GitHub Actions and secrets.`, '', 'To fix this, run:', '  gh auth refresh -h github.com -s repo,workflow', '', 'This will add the necessary permissions to manage workflows and secrets.']
          }));
          return;
        }
      }
    }

    // Check if in a git repo and get remote URL
// 当前仓库从 git 远端推导，推不出来就留空，让用户手填
    const currentRepo = (await getGithubRepo()) ?? '';
    logEvent('tengu_install_github_app_step_completed', {
      step: 'check-gh' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    setState(prev_0 => ({
      ...prev_0,
      warnings,
      currentRepo,
      selectedRepoName: currentRepo,
      useCurrentRepo: !!currentRepo,
      // Set to false if no repo detected
// 有警告进警告页，没有就直接进选仓库：警告不是错误，用户确认即可继续
      step: warnings.length > 0 ? 'warnings' : 'choose-repo'
    }));
  }, []);
// 这个效果只在步骤停在检查时触发一次，后续步骤变化不会重复执行
  React.useEffect(() => {
    if (state.step === 'check-gh') {
      void checkGitHubCLI();
    }
  }, [state.step, checkGitHubCLI]);
// 真正的执行：先把步骤切到创建中，再调底层安装逻辑。下面的依赖表把函数体里读到的每个状态都列上了，漏一个就会读到旧值
  const runSetupGitHubActions = useCallback(async (apiKeyOrOAuthToken: string | null, secretName: string) => {
    setState(prev_1 => ({
      ...prev_1,
      step: 'creating',
      currentWorkflowInstallStep: 0
    }));
    try {
// 进度回调按工作流个数递增，界面据此显示装到第几个
      await setupGitHubActions(state.selectedRepoName, apiKeyOrOAuthToken, secretName, () => {
        setState(prev_4 => ({
          ...prev_4,
          currentWorkflowInstallStep: prev_4.currentWorkflowInstallStep + 1
        }));
      }, state.workflowAction === 'skip', state.selectedWorkflows, state.authType, {
        useCurrentRepo: state.useCurrentRepo,
        workflowExists: state.workflowExists,
        secretExists: state.secretExists
      });
      logEvent('tengu_install_github_app_step_completed', {
        step: 'creating' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      setState(prev_5 => ({
        ...prev_5,
        step: 'success'
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to set up GitHub Actions';
// 工作流文件已存在是预期内的冲突，单独给一条带解决步骤的错误，而不是把原始报错抛给用户
      if (errorMessage.includes('workflow file already exists')) {
        logEvent('tengu_install_github_app_error', {
          reason: 'workflow_file_exists' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        setState(prev_2 => ({
          ...prev_2,
          step: 'error',
          error: 'A Claude workflow file already exists in this repository.',
          errorReason: 'Workflow file conflict',
          errorInstructions: ['The file .github/workflows/claude.yml already exists', 'You can either:', '  1. Delete the existing file and run this command again', '  2. Update the existing file manually using the template from:', `     ${GITHUB_ACTION_SETUP_DOCS_URL}`]
        }));
      } else {
        logEvent('tengu_install_github_app_error', {
          reason: 'setup_github_actions_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        setState(prev_3 => ({
          ...prev_3,
          step: 'error',
          error: errorMessage,
          errorReason: 'GitHub Actions setup failed',
          errorInstructions: []
        }));
      }
    }
  }, [state.selectedRepoName, state.workflowAction, state.selectedWorkflows, state.useCurrentRepo, state.workflowExists, state.secretExists, state.authType]);
  async function openGitHubAppInstallation() {
    const installUrl = 'https://github.com/apps/claude';
    await openBrowser(installUrl);
  }
  async function checkRepositoryPermissions(repoName: string): Promise<{
    hasAccess: boolean;
    error?: string;
  }> {
    try {
// 用接口查仓库权限，取管理员布尔值
      const result = await execFileNoThrow('gh', ['api', `repos/${repoName}`, '--jq', '.permissions.admin']);
      if (result.code === 0) {
        const hasAdmin = result.stdout.trim() === 'true';
        return {
          hasAccess: hasAdmin
        };
      }
// 不存在与无权限要分开：仓库名写错时提示词完全不同
      if (result.stderr.includes('404') || result.stderr.includes('Not Found')) {
        return {
          hasAccess: false,
          error: 'repository_not_found'
        };
      }
      return {
        hasAccess: false
      };
    } catch {
      return {
        hasAccess: false
      };
    }
  }
// 取文件摘要，能取到就说明工作流文件已经存在
  async function checkExistingWorkflowFile(repoName_0: string): Promise<boolean> {
    const checkFileResult = await execFileNoThrow('gh', ['api', `repos/${repoName_0}/contents/.github/workflows/claude.yml`, '--jq', '.sha']);
    return checkFileResult.code === 0;
  }
  async function checkExistingSecret() {
// 列出仓库密钥，再按名字匹配
    const checkSecretsResult = await execFileNoThrow('gh', ['secret', 'list', '--app', 'actions', '--repo', state.selectedRepoName]);
    if (checkSecretsResult.code === 0) {
      const lines = checkSecretsResult.stdout.split('\n');
// 按行首匹配密钥名，避开值里出现的同名字符串
      const hasAnthropicKey = lines.some((line: string) => {
        return /^ANTHROPIC_API_KEY\s+/.test(line);
      });
      if (hasAnthropicKey) {
        setState(prev_6 => ({
          ...prev_6,
          secretExists: true,
          step: 'check-existing-secret'
        }));
      } else {
        // No existing secret found
// 本地有密钥就跳过输入步骤直接安装：少一步交互，也避免用户重复粘贴
        if (existingApiKey) {
          // User has local key, skip to creating with it
          setState(prev_7 => ({
            ...prev_7,
            apiKeyOrOAuthToken: existingApiKey,
            useExistingKey: true
          }));
          await runSetupGitHubActions(existingApiKey, state.secretName);
        } else {
          // No local key, go to API key step
          setState(prev_8 => ({
            ...prev_8,
            step: 'api-key'
          }));
        }
      }
// 查密钥失败时同样优先用本地密钥继续，查不到不等于不能装
    } else {
      // Error checking secrets
      if (existingApiKey) {
        // User has local key, skip to creating with it
        setState(prev_9 => ({
          ...prev_9,
          apiKeyOrOAuthToken: existingApiKey,
          useExistingKey: true
        }));
        await runSetupGitHubActions(existingApiKey, state.secretName);
      } else {
        // No local key, go to API key step
        setState(prev_10 => ({
          ...prev_10,
          step: 'api-key'
        }));
      }
    }
  }
// 提交处理器就是一整条状态机：每个步骤一个分支，分支里决定下一个步骤
  const handleSubmit = async () => {
    if (state.step === 'warnings') {
      logEvent('tengu_install_github_app_step_completed', {
        step: 'warnings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      setState(prev_11 => ({
        ...prev_11,
        step: 'install-app'
      }));
// 把打开浏览器推迟到下一个事件循环：当前这次渲染还在切换步骤，立刻打开会与状态更新抢
      setTimeout(openGitHubAppInstallation, 0);
    } else if (state.step === 'choose-repo') {
      let repoName_1 = state.useCurrentRepo ? state.currentRepo : state.selectedRepoName;
      if (!repoName_1.trim()) {
        return;
      }
      const repoWarnings: Warning[] = [];
// 允许粘贴完整地址，从里面抠出所有者与仓库两段
      if (repoName_1.includes('github.com')) {
        const match = repoName_1.match(/github\.com[:/]([^/]+\/[^/]+)(\.git)?$/);
        if (!match) {
          repoWarnings.push({
            title: 'Invalid GitHub URL format',
            message: 'The repository URL format appears to be invalid.',
            instructions: ['Use format: owner/repo or https://github.com/owner/repo', 'Example: anthropics/claude-cli']
          });
        } else {
          repoName_1 = match[1]?.replace(/\.git$/, '') || '';
        }
      }
// 不含斜杠的一律提醒格式问题，但仍然继续检查，让用户看到更完整的信息
      if (!repoName_1.includes('/')) {
        repoWarnings.push({
          title: 'Repository format warning',
          message: 'Repository should be in format "owner/repo"',
          instructions: ['Use format: owner/repo', 'Example: anthropics/claude-cli']
        });
      }
// 权限检查的结果决定是加警告还是直接放行
      const permissionCheck = await checkRepositoryPermissions(repoName_1);
      if (permissionCheck.error === 'repository_not_found') {
        repoWarnings.push({
          title: 'Repository not found',
          message: `Repository ${repoName_1} was not found or you don't have access.`,
          instructions: [`Check that the repository name is correct: ${repoName_1}`, 'Ensure you have access to this repository', 'For private repositories, make sure your GitHub token has the "repo" scope', 'You can add the repo scope with: gh auth refresh -h github.com -s repo,workflow']
        });
      } else if (!permissionCheck.hasAccess) {
        repoWarnings.push({
          title: 'Admin permissions required',
          message: `You might need admin permissions on ${repoName_1} to set up GitHub Actions.`,
          instructions: ['Repository admins can install GitHub Apps and set secrets', 'Ask a repository admin to run this command if setup fails', 'Alternatively, you can use the manual setup instructions']
        });
      }
// 工作流是否已存在会影响后面的分支，所以在这里一并查掉
      const workflowExists = await checkExistingWorkflowFile(repoName_1);
      if (repoWarnings.length > 0) {
        const allWarnings = [...state.warnings, ...repoWarnings];
        setState(prev_12 => ({
          ...prev_12,
          selectedRepoName: repoName_1,
          workflowExists,
          warnings: allWarnings,
          step: 'warnings'
        }));
      } else {
        logEvent('tengu_install_github_app_step_completed', {
          step: 'choose-repo' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        setState(prev_13 => ({
          ...prev_13,
          selectedRepoName: repoName_1,
          workflowExists,
          step: 'install-app'
        }));
        setTimeout(openGitHubAppInstallation, 0);
      }
    } else if (state.step === 'install-app') {
      logEvent('tengu_install_github_app_step_completed', {
        step: 'install-app' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
// 已存在就走询问分支，不存在就直接去选工作流
      if (state.workflowExists) {
        setState(prev_14 => ({
          ...prev_14,
          step: 'check-existing-workflow'
        }));
      } else {
        setState(prev_15 => ({
          ...prev_15,
          step: 'select-workflows'
        }));
      }
    } else if (state.step === 'check-existing-workflow') {
      return;
    } else if (state.step === 'select-workflows') {
      // Handled by the WorkflowMultiselectDialog component
      return;
    } else if (state.step === 'check-existing-secret') {
      logEvent('tengu_install_github_app_step_completed', {
        step: 'check-existing-secret' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
// 沿用已有密钥就传空，让底层只装工作流不写密钥
      if (state.useExistingSecret) {
        await runSetupGitHubActions(null, state.secretName);
      } else {
        // User wants to use a new secret name with their API key
        await runSetupGitHubActions(state.apiKeyOrOAuthToken, state.secretName);
      }
    } else if (state.step === 'api-key') {
      // In the new flow, api-key step only appears when user has no existing key
      // They either entered a new key or will create OAuth token
// 选授权流程时这里直接返回：令牌由另一条流程产出，回来时会自己接着走
      if (state.selectedApiKeyOption === 'oauth') {
        // OAuth flow already handled by handleCreateOAuthToken
        return;
      }

      // If user selected 'existing' option, use the existing API key
// 选沿用本地密钥时用本地值，选新建时用输入框里的值
      const apiKeyToUse = state.selectedApiKeyOption === 'existing' ? existingApiKey : state.apiKeyOrOAuthToken;
      if (!apiKeyToUse) {
        logEvent('tengu_install_github_app_error', {
          reason: 'api_key_missing' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        setState(prev_16 => ({
          ...prev_16,
          step: 'error',
          error: 'API key is required'
        }));
        return;
      }

      // Store the API key being used (either existing or newly entered)
      setState(prev_17 => ({
        ...prev_17,
        apiKeyOrOAuthToken: apiKeyToUse,
        useExistingKey: state.selectedApiKeyOption === 'existing'
      }));

      // Check if ANTHROPIC_API_KEY secret already exists
// 写密钥前再查一次是否已存在，避免覆盖别人的配置
      const checkSecretsResult_0 = await execFileNoThrow('gh', ['secret', 'list', '--app', 'actions', '--repo', state.selectedRepoName]);
      if (checkSecretsResult_0.code === 0) {
        const lines_0 = checkSecretsResult_0.stdout.split('\n');
        const hasAnthropicKey_0 = lines_0.some((line_0: string) => {
          return /^ANTHROPIC_API_KEY\s+/.test(line_0);
        });
        if (hasAnthropicKey_0) {
          logEvent('tengu_install_github_app_step_completed', {
            step: 'api-key' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          setState(prev_18 => ({
            ...prev_18,
            secretExists: true,
            step: 'check-existing-secret'
          }));
        } else {
          logEvent('tengu_install_github_app_step_completed', {
            step: 'api-key' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          // No existing secret, proceed to creating
          await runSetupGitHubActions(apiKeyToUse, state.secretName);
        }
      } else {
        logEvent('tengu_install_github_app_step_completed', {
          step: 'api-key' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        // Error checking secrets, proceed anyway
        await runSetupGitHubActions(apiKeyToUse, state.secretName);
      }
    }
  };
  const handleRepoUrlChange = (value: string) => {
    setState(prev_19 => ({
      ...prev_19,
      selectedRepoName: value
    }));
  };
  const handleApiKeyChange = (value_0: string) => {
    setState(prev_20 => ({
      ...prev_20,
      apiKeyOrOAuthToken: value_0
    }));
  };
  const handleApiKeyOptionChange = (option: 'existing' | 'new' | 'oauth') => {
    setState(prev_21 => ({
      ...prev_21,
      selectedApiKeyOption: option
    }));
  };
  const handleCreateOAuthToken = useCallback(() => {
    logEvent('tengu_install_github_app_step_completed', {
      step: 'api-key' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    setState(prev_22 => ({
      ...prev_22,
      step: 'oauth-flow'
    }));
  }, []);
  const handleOAuthSuccess = useCallback((token: string) => {
    logEvent('tengu_install_github_app_step_completed', {
      step: 'oauth-flow' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    setState(prev_23 => ({
      ...prev_23,
      apiKeyOrOAuthToken: token,
      useExistingKey: false,
      secretName: 'CLAUDE_CODE_OAUTH_TOKEN',
      authType: 'oauth_token'
    }));
    void runSetupGitHubActions(token, 'CLAUDE_CODE_OAUTH_TOKEN');
  }, [runSetupGitHubActions]);
  const handleOAuthCancel = useCallback(() => {
    setState(prev_24 => ({
      ...prev_24,
      step: 'api-key'
    }));
  }, []);
  const handleSecretNameChange = (value_1: string) => {
// 密钥名只允许字母数字下划线，非法字符直接丢弃这次输入而不是报错
    if (value_1 && !/^[a-zA-Z0-9_]+$/.test(value_1)) return;
    setState(prev_25 => ({
      ...prev_25,
      secretName: value_1
    }));
  };
  const handleToggleUseCurrentRepo = (useCurrentRepo: boolean) => {
    setState(prev_26 => ({
      ...prev_26,
      useCurrentRepo,
// 切换仓库来源时同时改名字段：勾上就填当前仓库，取消就清空，避免残留旧值
      selectedRepoName: useCurrentRepo ? prev_26.currentRepo : ''
    }));
  };
  const handleToggleUseExistingKey = (useExistingKey: boolean) => {
    setState(prev_27 => ({
      ...prev_27,
      useExistingKey
    }));
  };
  const handleToggleUseExistingSecret = (useExistingSecret: boolean) => {
    setState(prev_28 => ({
      ...prev_28,
      useExistingSecret,
// 切换密钥来源时重置名字：沿用就回到默认名，新建就清空
      secretName: useExistingSecret ? 'ANTHROPIC_API_KEY' : ''
    }));
  };
// 工作流已存在时的三种选择：更新、跳过、退出。退出直接结束整个命令
  const handleWorkflowAction = async (action: 'update' | 'skip' | 'exit') => {
    if (action === 'exit') {
      props.onDone('Installation cancelled by user');
      return;
    }
    logEvent('tengu_install_github_app_step_completed', {
      step: 'check-existing-workflow' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    setState(prev_29 => ({
      ...prev_29,
      workflowAction: action
    }));
    if (action === 'skip' || action === 'update') {
      // Check if user has existing local API key
      if (existingApiKey) {
        await checkExistingSecret();
      } else {
        // No local key, go straight to API key step
        setState(prev_30 => ({
          ...prev_30,
          step: 'api-key'
        }));
      }
    }
  };
  function handleDismissKeyDown(e: KeyboardEvent): void {
    e.preventDefault();
    if (state.step === 'success') {
      logEvent('tengu_install_github_app_completed', {});
    }
// 收尾文案按状态分三种：成功、带具体错误、无具体错误但失败
    props.onDone(state.step === 'success' ? 'GitHub Actions setup complete!' : state.error ? `Couldn't install GitHub App: ${state.error}\nFor manual setup instructions, see: ${GITHUB_ACTION_SETUP_DOCS_URL}` : `GitHub App installation failed\nFor manual setup instructions, see: ${GITHUB_ACTION_SETUP_DOCS_URL}`);
  }
// 按步骤渲染：十一个分支各自对应一个独立组件，状态机与视图完全解耦
  switch (state.step) {
    case 'check-gh':
      return <CheckGitHubStep />;
    case 'warnings':
      return <WarningsStep warnings={state.warnings} onContinue={handleSubmit} />;
    case 'choose-repo':
      return <ChooseRepoStep currentRepo={state.currentRepo} useCurrentRepo={state.useCurrentRepo} repoUrl={state.selectedRepoName} onRepoUrlChange={handleRepoUrlChange} onToggleUseCurrentRepo={handleToggleUseCurrentRepo} onSubmit={handleSubmit} />;
    case 'install-app':
      return <InstallAppStep repoUrl={state.selectedRepoName} onSubmit={handleSubmit} />;
    case 'check-existing-workflow':
      return <ExistingWorkflowStep repoName={state.selectedRepoName} onSelectAction={handleWorkflowAction} />;
    case 'check-existing-secret':
      return <CheckExistingSecretStep useExistingSecret={state.useExistingSecret} secretName={state.secretName} onToggleUseExistingSecret={handleToggleUseExistingSecret} onSecretNameChange={handleSecretNameChange} onSubmit={handleSubmit} />;
    case 'api-key':
      return <ApiKeyStep existingApiKey={existingApiKey} useExistingKey={state.useExistingKey} apiKeyOrOAuthToken={state.apiKeyOrOAuthToken} onApiKeyChange={handleApiKeyChange} onToggleUseExistingKey={handleToggleUseExistingKey} onSubmit={handleSubmit} onCreateOAuthToken={isAnthropicAuthEnabled() ? handleCreateOAuthToken : undefined} selectedOption={state.selectedApiKeyOption} onSelectOption={handleApiKeyOptionChange} />;
    case 'creating':
      return <CreatingStep currentWorkflowInstallStep={state.currentWorkflowInstallStep} secretExists={state.secretExists} useExistingSecret={state.useExistingSecret} secretName={state.secretName} skipWorkflow={state.workflowAction === 'skip'} selectedWorkflows={state.selectedWorkflows} />;
    case 'success':
// 成功页与错误页要能接键盘，所以外面包一层可聚焦的容器
      return <Box tabIndex={0} autoFocus onKeyDown={handleDismissKeyDown}>
          <SuccessStep secretExists={state.secretExists} useExistingSecret={state.useExistingSecret} secretName={state.secretName} skipWorkflow={state.workflowAction === 'skip'} />
        </Box>;
    case 'error':
      return <Box tabIndex={0} autoFocus onKeyDown={handleDismissKeyDown}>
          <ErrorStep error={state.error} errorReason={state.errorReason} errorInstructions={state.errorInstructions} />
        </Box>;
    case 'select-workflows':
// 多选提交后分化：有本地密钥就去查密钥，没有就直接进输入步骤
      return <WorkflowMultiselectDialog defaultSelections={state.selectedWorkflows} onSubmit={selectedWorkflows => {
        logEvent('tengu_install_github_app_step_completed', {
          step: 'select-workflows' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        setState(prev_31 => ({
          ...prev_31,
          selectedWorkflows
        }));
        // Check if user has existing local API key
        if (existingApiKey) {
          void checkExistingSecret();
        } else {
          // No local key, go straight to API key step
          setState(prev_32 => ({
            ...prev_32,
            step: 'api-key'
          }));
        }
      }} />;
    case 'oauth-flow':
      return <OAuthFlowStep onSuccess={handleOAuthSuccess} onCancel={handleOAuthCancel} />;
  }
}
export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  return <InstallGitHubApp onDone={onDone} />;
}
// 原文件此处有一行 62708 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。