// 本文件集中存放「哪些工具算作 shell 类工具」以及 PowerShell 工具在 Windows 上的开关判据；把这类纯常量与纯函数拆出来，是为避免与工具列表、命令路由等模块形成循环依赖。
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { getPlatform } from '../platform.js'

export const SHELL_TOOL_NAMES: string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME]
// SHELL_TOOL_NAMES 把 Bash 与 PowerShell 两个工具名收进同一个数组，供工具列表可见性、命令路由等场景统一判断某工具是否属于 shell 类。

/**
 * Runtime gate for PowerShellTool. Windows-only (the permission engine uses
 * Win32-specific path normalizations). Ant defaults on (opt-out via env=0);
 * external defaults off (opt-in via env=1).
 *
 * Used by tools.ts (tool-list visibility), processBashCommand (! routing),
 * and promptShellExecution (skill frontmatter routing) so the gate is
 * consistent across all paths that invoke PowerShellTool.call().
 */
export function isPowerShellToolEnabled(): boolean {
  if (getPlatform() !== 'windows') return false
  return process.env.USER_TYPE === 'ant'
    ? !isEnvDefinedFalsy(process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL)
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL)
}
// isPowerShellToolEnabled 是 PowerShell 工具的开关：仅在 Windows 上可能返回 true；当 USER_TYPE 为内部用户时默认开启（可用环境变量置 0 关闭），为外部用户时默认关闭（可用环境变量置 1 开启）。该判据被工具列表、命令路由、技能 frontmatter 路由共用，保证处处一致。
