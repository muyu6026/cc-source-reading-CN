// 文件级。解析输入框 `!` 命令要用哪种默认 shell，平台统一默认 `bash`，不随 Windows 自动切到 PowerShell。
import { getInitialSettings } from '../settings/settings.js'

/**
 * Resolve the default shell for input-box `!` commands.
 *
 * Resolution order (docs/design/ps-shell-selection.md §4.2):
 *   settings.defaultShell → 'bash'
 *
 * Platform default is 'bash' everywhere — we do NOT auto-flip Windows to
 * PowerShell (would break existing Windows users with bash hooks).
 */
export function resolveDefaultShell(): 'bash' | 'powershell' {
  return getInitialSettings().defaultShell ?? 'bash'
// 先读设置项的 `defaultShell`，为空时回退到 `bash`；显式写明不自动翻到 PowerShell，是为了不破坏那些在 Windows 上已经配好 bash 钩子的老用户。
}
