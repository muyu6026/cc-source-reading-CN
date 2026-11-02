// 模块总述：本文件是 agent teams / teammate 功能的统一运行时开关，作为全代码库引用队友能力时的唯一判据闸门，集中处理内外部构建的差异与 killswitch。
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvTruthy } from './envUtils.js'

/**
 * Check if --agent-teams flag is provided via CLI.
 * Checks process.argv directly to avoid import cycles with bootstrap/state.
 * Note: The flag is only shown in help for ant users, but if external users
 * pass it anyway, it will work (subject to the killswitch).
 */
// 私有辅助函数 isAgentTeamsFlagSet：直接从 process.argv 读取 `--agent-teams` 标志，刻意不经由 bootstrap / state 模块以避免引入 import 环。
function isAgentTeamsFlagSet(): boolean {
  return process.argv.includes('--agent-teams')
}

/**
 * Centralized runtime check for agent teams/teammate features.
 * This is the single gate that should be checked everywhere teammates
 * are referenced (prompts, code, tools isEnabled, UI, etc.).
 *
 * Ant builds: always enabled.
 * External builds require both:
 * 1. Opt-in via CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var OR --agent-teams flag
 * 2. GrowthBook gate 'tengu_amber_flint' enabled (killswitch)
 */
// 公开闸门 isAgentSwarmsEnabled：全代码库判断是否启用队友功能的唯一入口，prompts、工具、UI 等都应调用它而非各自判断。
export function isAgentSwarmsEnabled(): boolean {
  // Ant: always on
  if (process.env.USER_TYPE === 'ant') {
    return true
  }

  // External: require opt-in via env var or --agent-teams flag
  if (
    !isEnvTruthy(process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) &&
    !isAgentTeamsFlagSet()
  ) {
    return false
  }

  // Killswitch — always respected for external users
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_flint', true)) {
// killswitch 判定：外部构建下即便用户已 opt-in，只要 GrowthBook 的 `tengu_amber_flint` 开关关闭（取缓存值，可能略旧）就一律拒绝启用。
    return false
  }

  return true
}
