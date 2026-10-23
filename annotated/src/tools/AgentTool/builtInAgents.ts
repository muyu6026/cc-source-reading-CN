import { feature } from 'bun:bundle'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { CLAUDE_CODE_GUIDE_AGENT } from './built-in/claudeCodeGuideAgent.js'
import { EXPLORE_AGENT } from './built-in/exploreAgent.js'
import { GENERAL_PURPOSE_AGENT } from './built-in/generalPurposeAgent.js'
import { PLAN_AGENT } from './built-in/planAgent.js'
import { STATUSLINE_SETUP_AGENT } from './built-in/statuslineSetup.js'
import { VERIFICATION_AGENT } from './built-in/verificationAgent.js'
import type { AgentDefinition } from './loadAgentsDir.js'

// areExplorePlanAgentsEnabled：Explore/Plan 两个只读搜索 agent 的总开关。
export function areExplorePlanAgentsEnabled(): boolean {
  if (feature('BUILTIN_EXPLORE_PLAN_AGENTS')) {
    // 3P default: true — Bedrock/Vertex keep agents enabled (matches pre-experiment
    // external behavior). A/B test treatment sets false to measure impact of removal.
    return getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_stoat', true)
  }
  return false
}
// 3P 默认 true：Bedrock/Vertex 保持启用（与实验前外部行为一致——不偷偷改用户可见的工具面）；A/B 治疗组设 false 测量移除影响。kill-switch 是 GrowthBook 的 tengu_amber_stoat。

// getBuiltInAgents：内置 agent 清单的组装处——多处环境判断决定最终列表。
export function getBuiltInAgents(): AgentDefinition[] {
  // Allow disabling all built-in agents via env var (useful for SDK users who want a blank slate)
  // Only applies in noninteractive mode (SDK/API usage)
  if (
    isEnvTruthy(process.env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS) &&
    getIsNonInteractiveSession()
  ) {
    return []
  }
// SDK 白 slate 出口：CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS + 非交互会话双条件才返回空——SDK 用户可以只要空工具面自己搭；交互用户永远有内置 agent（免得把自己绕晕）。

  // Use lazy require inside the function body to avoid circular dependency
  // issues at module init time. The coordinatorMode module depends on tools
  // which depend on AgentTool which imports this file.
  if (feature('COORDINATOR_MODE')) {
    if (isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE)) {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { getCoordinatorAgents } =
        require('../../coordinator/workerAgent.js') as typeof import('../../coordinator/workerAgent.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      return getCoordinatorAgents()
    }
  }
// coordinator 模式用函数体内 require 而不是顶部 import：coordinatorMode 依赖 tools → AgentTool → 本文件，模块初始化期直接 import 会踩循环依赖。eslint-disable 是明知故犯——这里懒加载是唯一解。

  const agents: AgentDefinition[] = [
    GENERAL_PURPOSE_AGENT,
    STATUSLINE_SETUP_AGENT,
  ]
// 常驻两个：GENERAL_PURPOSE_AGENT（默认全能）+ STATUSLINE_SETUP_AGENT（状态栏安装，one-shot）。

  if (areExplorePlanAgentsEnabled()) {
    agents.push(EXPLORE_AGENT, PLAN_AGENT)
  }
// Explore/Plan 受 areExplorePlanAgentsEnabled 门控——A/B 实验的控制组就没有这两个。

  // Include Code Guide agent for non-SDK entrypoints
  const isNonSdkEntrypoint =
    process.env.CLAUDE_CODE_ENTRYPOINT !== 'sdk-ts' &&
    process.env.CLAUDE_CODE_ENTRYPOINT !== 'sdk-py' &&
    process.env.CLAUDE_CODE_ENTRYPOINT !== 'sdk-cli'

  if (isNonSdkEntrypoint) {
    agents.push(CLAUDE_CODE_GUIDE_AGENT)
  }
// Code Guide agent 只对非 SDK 入口注册（sdk-ts / sdk-py / sdk-cli 排除）——文档问答 agent 对编程式消费者没用，还占工具表空间。

  if (
    feature('VERIFICATION_AGENT') &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_hive_evidence', false)
  ) {
    agents.push(VERIFICATION_AGENT)
  }
// VERIFICATION_AGENT 双门控：feature('VERIFICATION_AGENT') + GrowthBook tengu_hive_evidence 默认 false——实验性 agent，默认不露面。

  return agents
}
// 返回顺序即 UI 显示顺序：general-purpose 打头，实验性 agent 垫底。
