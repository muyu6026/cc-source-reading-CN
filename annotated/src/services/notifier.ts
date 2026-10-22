import type { TerminalNotification } from '../ink/useTerminalNotification.js'
import { getGlobalConfig } from '../utils/config.js'
import { env } from '../utils/env.js'
import { execFileNoThrow } from '../utils/execFileNoThrow.js'
import { executeNotificationHooks } from '../utils/hooks.js'
import { logError } from '../utils/log.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from './analytics/index.js'

export type NotificationOptions = {
  message: string
  title?: string
  notificationType: string
}

export async function sendNotification(
  notif: NotificationOptions,
  terminal: TerminalNotification,
): Promise<void> {
  const config = getGlobalConfig()
  const channel = config.preferredNotifChannel
// 通知**通道**来自全局配置 `preferredNotifChannel`，不是运行时猜的——用户明确说自己用 iTerm2 还是 kitty，比探测准。`auto` 才是「你自己看着办」（由 `sendAuto` 按 `env.terminal` 判断）。

  await executeNotificationHooks(notif)
// 先跑**用户配置的 Notification hook**，再走内置通道。两条腿是独立的：hook 是用户自己的脚本（可能是推送到手机、可能是播 TTS），内置通道是终端特有的提示方式。hook 失败不影响内置通道——`executeNotificationHooks` 内部吞错，它不该成为通知失败的原因。

  const methodUsed = await sendToChannel(channel, notif, terminal)
// `sendToChannel` 返回的是**实际用了哪种方式**，和「配置要求用哪种」一起上报。这条遥测专门用来发现「配了但不生效」：比如用户配了 `kitty`，但实际跑在 tmux 里，`methodUsed` 会诚实地说是 `error` 或 `none`。返回值是字符串而不是布尔，正是为了让遥测能区分十几种情形。

  logEvent('tengu_notification_method_used', {
    configured_channel:
      channel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    method_used:
      methodUsed as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    term: env.terminal as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

const DEFAULT_TITLE = 'Claude Code'

async function sendToChannel(
  channel: string,
  opts: NotificationOptions,
  terminal: TerminalNotification,
): Promise<string> {
  const title = opts.title || DEFAULT_TITLE

  try {
// 九个通道的 switch，外面套一层 `try/catch` 整体兜住：任何一条终端转义序列写失败、`osascript` 不存在、随机数生成出错，都退化成返回 `'error'`。**通知失败绝不能影响主流程**——它发生在「回答已经写完了、等你回来看」的时刻，这时候抛异常只会让用户看到一条红色错误而不是结果。
    switch (channel) {
      case 'auto':
        return sendAuto(opts, terminal)
      case 'iterm2':
        terminal.notifyITerm2(opts)
        return 'iterm2'
      case 'iterm2_with_bell':
        terminal.notifyITerm2(opts)
        terminal.notifyBell()
        return 'iterm2_with_bell'
      case 'kitty':
        terminal.notifyKitty({ ...opts, title, id: generateKittyId() })
        return 'kitty'
      case 'ghostty':
        terminal.notifyGhostty({ ...opts, title })
        return 'ghostty'
      case 'terminal_bell':
        terminal.notifyBell()
        return 'terminal_bell'
      case 'notifications_disabled':
        return 'disabled'
      default:
        return 'none'
    }
  } catch {
    return 'error'
  }
}

async function sendAuto(
  opts: NotificationOptions,
  terminal: TerminalNotification,
): Promise<string> {
  const title = opts.title || DEFAULT_TITLE

// `auto` 的判定完全靠 `env.terminal` 环境变量（`TERM_PROGRAM` 那一套）。三个分支各有一种降级：iTerm2/kitty/ghostty 有专有转义序列直接弹通知；`Apple_Terminal` 没有，只能响铃——而且还要先查用户是不是把 bell 关了（关了就连铃都不响，直接报 `no_method_available`），这种情况比「响一声」更该被如实上报。
  switch (env.terminal) {
    case 'Apple_Terminal': {
      const bellDisabled = await isAppleTerminalBellDisabled()
      if (bellDisabled) {
        terminal.notifyBell()
        return 'terminal_bell'
      }
      return 'no_method_available'
    }
    case 'iTerm.app':
      terminal.notifyITerm2(opts)
      return 'iterm2'
    case 'kitty':
      terminal.notifyKitty({ ...opts, title, id: generateKittyId() })
      return 'kitty'
    case 'ghostty':
      terminal.notifyGhostty({ ...opts, title })
      return 'ghostty'
    default:
      return 'no_method_available'
  }
}

function generateKittyId(): number {
  return Math.floor(Math.random() * 10000)
}

async function isAppleTerminalBellDisabled(): Promise<boolean> {
// 这个函数回答的是「Apple Terminal 当前 profile 里 bell 是不是被关掉了」。三步：① `osascript` 问 Terminal 前窗口用的是哪个 profile 名；② `defaults export com.apple.Terminal -` 把整个偏好导出成 plist 文本；③ 解析 plist 找到 `Window Settings[profile].Bell`。任何一步失败都返回 `false`（**当作 bell 可用**）——宁可按「可能响一声」处理，也不要因为探测失败就彻底不通知。
  try {
    if (env.terminal !== 'Apple_Terminal') {
      return false
    }

    const osascriptResult = await execFileNoThrow('osascript', [
      '-e',
      'tell application "Terminal" to name of current settings of front window',
    ])
    const currentProfile = osascriptResult.stdout.trim()

    if (!currentProfile) {
      return false
    }

    const defaultsOutput = await execFileNoThrow('defaults', [
      'export',
      'com.apple.Terminal',
      '-',
    ])

    if (defaultsOutput.code !== 0) {
      return false
    }

    // Lazy-load plist (~280KB with xmlbuilder+@xmldom) — only hit on
    // Apple_Terminal with auto-channel, which is a small fraction of users.
    const plist = await import('plist')
// `import('plist')` 是**动态 + 懒加载**，注释给了理由：plist 依赖 xmlbuilder 和 `@xmldom`，整个包约 280KB，只有「用 Apple Terminal + 通道选 auto」这一小撮用户会走到这里。静态 import 会让所有人的启动都多解析 280KB 的 JS。
    const parsed: Record<string, unknown> = plist.parse(defaultsOutput.stdout)
    const windowSettings = parsed?.['Window Settings'] as
      | Record<string, unknown>
      | undefined
    const profileSettings = windowSettings?.[currentProfile] as
      | Record<string, unknown>
      | undefined

    if (!profileSettings) {
      return false
    }

    return profileSettings.Bell === false
  } catch (error) {
    logError(error)
    return false
  }
}
