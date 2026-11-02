import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
// 后台远程会话（teleport）的资格判定模块：把「能不能开远程会话」拆成一组可枚举的前置条件，供 UI 直接渲染缺什么。
import { checkGate_CACHED_OR_BLOCKING } from '../../../services/analytics/growthbook.js'
import { isPolicyAllowed } from '../../../services/policyLimits/index.js'
import { detectCurrentRepositoryWithHost } from '../../detectRepository.js'
import { isEnvTruthy } from '../../envUtils.js'
import type { TodoList } from '../../todo/types.js'
import {
  checkGithubAppInstalled,
  checkHasRemoteEnvironment,
  checkIsInGitRepo,
  checkNeedsClaudeAiLogin,
} from './preconditions.js'

/**
 * Background remote session type for managing teleport sessions
 */
export type BackgroundRemoteSession = {
  id: string
  command: string
  startTime: number
  status: 'starting' | 'running' | 'completed' | 'failed' | 'killed'
  todoList: TodoList
  title: string
  type: 'remote_session'
  log: SDKMessage[]
}
// 会话记录只存渲染所需的最小集合：状态机五态加 todo 列表加 SDK 消息日志，真正的执行体在远端。

/**
 * Precondition failures for background remote sessions
 */
export type BackgroundRemoteSessionPrecondition =
  | { type: 'not_logged_in' }
  | { type: 'no_remote_environment' }
  | { type: 'not_in_git_repo' }
  | { type: 'no_git_remote' }
  | { type: 'github_app_not_installed' }
  | { type: 'policy_blocked' }
// 前置条件用可辨识联合而不是布尔集合：调用方能按 type 给出精确修复指引（去登录、去装 GitHub App、去开策略权限）。

/**
 * Checks eligibility for creating a background remote session
 * Returns an array of failed preconditions (empty array means all checks passed)
 *
 * @returns Array of failed preconditions
 */
export async function checkBackgroundRemoteSessionEligibility({
  skipBundle = false,
}: {
  skipBundle?: boolean
} = {}): Promise<BackgroundRemoteSessionPrecondition[]> {
  const errors: BackgroundRemoteSessionPrecondition[] = []
// 先收集再返回：所有失败原因一次给全，避免用户修一个再撞下一个。

  // Check policy first - if blocked, no need to check other preconditions
  if (!isPolicyAllowed('allow_remote_sessions')) {
    errors.push({ type: 'policy_blocked' })
    return errors
  }
// 策略拦截单独短路：被组织策略禁掉时其余检查毫无意义，也不必再发起网络请求。

  const [needsLogin, hasRemoteEnv, repository] = await Promise.all([
    checkNeedsClaudeAiLogin(),
    checkHasRemoteEnvironment(),
    detectCurrentRepositoryWithHost(),
  ])
// 三个检查并行发起：登录态、远程环境、当前仓库互不依赖，串行会把首次打开面板的延迟叠成三倍。

  if (needsLogin) {
    errors.push({ type: 'not_logged_in' })
  }

  if (!hasRemoteEnv) {
    errors.push({ type: 'no_remote_environment' })
  }

  // When bundle seeding is on, in-git-repo is enough — CCR can seed from
  // a local bundle. No GitHub remote or app needed. Same gate as
  // teleport.tsx bundleSeedGateOn.
  const bundleSeedGateOn =
    !skipBundle &&
    (isEnvTruthy(process.env.CCR_FORCE_BUNDLE) ||
      isEnvTruthy(process.env.CCR_ENABLE_BUNDLE) ||
      (await checkGate_CACHED_OR_BLOCKING('tengu_ccr_bundle_seed_enabled')))
// bundle 播种开启时的判定顺序：本地有 .git 就能打包上传，因此可以跳过 GitHub 远端与 App 安装检查。注释点明这里与 teleport.tsx 的门控必须保持一致。

  if (!checkIsInGitRepo()) {
    errors.push({ type: 'not_in_git_repo' })
  } else if (bundleSeedGateOn) {
    // has .git/, bundle will work — skip remote+app checks
  } else if (repository === null) {
    errors.push({ type: 'no_git_remote' })
  } else if (repository.host === 'github.com') {
    const hasGithubApp = await checkGithubAppInstalled(
      repository.owner,
      repository.name,
    )
    if (!hasGithubApp) {
      errors.push({ type: 'github_app_not_installed' })
    }
  }
// 分支链兜底：只有仓库宿主是 github.com 才检查 App 安装；其他宿主（如企业自建）不做这项判定，直接放行。

  return errors
}
// 返回空数组即全部通过；调用方约定按长度判断，不要另设布尔返回值，避免两套真相。
