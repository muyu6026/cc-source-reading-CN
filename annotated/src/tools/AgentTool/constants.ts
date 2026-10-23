export const AGENT_TOOL_NAME = 'Agent'
// Legacy wire name for backward compat (permission rules, hooks, resumed sessions)
export const LEGACY_AGENT_TOOL_NAME = 'Task'
// LEGACY_AGENT_TOOL_NAME：Task→Agent 改名后的线名（wire name）兼容——权限规则、钩子匹配、恢复的旧会话 transcript 都还认 Task，两套名字必须同时维护。
export const VERIFICATION_AGENT_TYPE = 'verification'
// VERIFICATION_AGENT_TYPE：验证 agent 的类型名常量（builtInAgents.ts 门控着它，这里给别处引用）。

// Built-in agents that run once and return a report — the parent never
// SendMessages back to continue them. Skip the agentId/SendMessage/usage
// trailer for these to save tokens (~135 chars × 34M Explore runs/week).
export const ONE_SHOT_BUILTIN_AGENT_TYPES: ReadonlySet<string> = new Set([
  'Explore',
  'Plan',
])
// ONE_SHOT_BUILTIN_AGENT_TYPES：Explore/Plan 跑完即返回报告，父级不会 SendMessage 回去继续对话——这两个的同步结果跳过 agentId/SendMessage/usage 尾 trailer，每次省 ~135 字符，乘以每周 34M 次 Explore 调用是可观的 token 账。
