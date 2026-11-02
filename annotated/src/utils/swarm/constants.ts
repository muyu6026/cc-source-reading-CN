// 本文件集中定义队友 / swarm 会话相关的常量与命名：团队 Lead 名、swarm 会话名、tmux 命令、隐藏会话名，以及若干队友进程的环境变量键名。
export const TEAM_LEAD_NAME = 'team-lead'
export const SWARM_SESSION_NAME = 'claude-swarm'
export const SWARM_VIEW_WINDOW_NAME = 'swarm-view'
export const TMUX_COMMAND = 'tmux'
export const HIDDEN_SESSION_NAME = 'claude-hidden'

/**
 * Gets the socket name for external swarm sessions (when user is not in tmux).
 * Uses a separate socket to isolate swarm operations from user's tmux sessions.
 * Includes PID to ensure multiple Claude instances don't conflict.
 */
// getSwarmSocketName：当用户不在 tmux 中时，为外部 swarm 会话生成独立 socket 名（含进程 pid 以隔离多个 Claude 实例），与用户自己的 tmux 会话互不干扰。
export function getSwarmSocketName(): string {
  return `claude-swarm-${process.pid}`
}

/**
 * Environment variable to override the command used to spawn teammate instances.
 * If not set, defaults to process.execPath (the current Claude binary).
 * This allows customization for different environments or testing.
 */
// 三枚 TEAMMATE_*_ENV_VAR 常量：分别定义队友进程的启动命令覆盖键、分配颜色键、以及是否强制先进入 plan 模式再写代码的开关键。
export const TEAMMATE_COMMAND_ENV_VAR = 'CLAUDE_CODE_TEAMMATE_COMMAND'

/**
 * Environment variable set on spawned teammates to indicate their assigned color.
 * Used for colored output and pane identification.
 */
export const TEAMMATE_COLOR_ENV_VAR = 'CLAUDE_CODE_AGENT_COLOR'

/**
 * Environment variable set on spawned teammates to require plan mode before implementation.
 * When set to 'true', teammates must enter plan mode and get approval before writing code.
 */
export const PLAN_MODE_REQUIRED_ENV_VAR = 'CLAUDE_CODE_PLAN_MODE_REQUIRED'
