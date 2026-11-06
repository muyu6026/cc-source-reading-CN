import figures from 'figures'
// 引入终端符号库、命令类型与沙箱适配器。
import type { Command } from '../../commands.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'

const command = {
// 定义 sandbox 命令对象，末尾用 satisfies Command 做类型校验。
  name: 'sandbox',
  get description() {
// 动态 description getter：根据沙箱当前状态拼装图标与文案。
    const currentlyEnabled = SandboxManager.isSandboxingEnabled()
// 一次性读取五项状态：是否启用、是否自动放行 bash、是否允许未沙箱命令、是否被策略锁定、依赖是否齐全。
    const autoAllow = SandboxManager.isAutoAllowBashIfSandboxedEnabled()
    const allowUnsandboxed = SandboxManager.areUnsandboxedCommandsAllowed()
    const isLocked = SandboxManager.areSandboxSettingsLockedByPolicy()
    const hasDeps = SandboxManager.checkDependencies().errors.length === 0

    // Show warning icon if dependencies missing, otherwise enabled/disabled status
// 注释：依赖缺失时显示警告图标，否则按启用状态显示对勾或圆圈。
    let icon: string
    if (!hasDeps) {
      icon = figures.warning
    } else {
      icon = currentlyEnabled ? figures.tick : figures.circle
    }

    let statusText = 'sandbox disabled'
// 拼装状态文案，默认值为 sandbox disabled。
    if (currentlyEnabled) {
// 启用时区分 auto-allow 与普通启用两种文案。
      statusText = autoAllow
        ? 'sandbox enabled (auto-allow)'
        : 'sandbox enabled'

      // Add unsandboxed fallback status
// 注释：启用且允许未沙箱命令时追加 fallback allowed。
      statusText += allowUnsandboxed ? ', fallback allowed' : ''
    }

    if (isLocked) {
// 被策略锁定时追加 (managed) 标记。
      statusText += ' (managed)'
    }

    return `${icon} ${statusText} (⏎ to configure)`
// 最终返回「图标 + 状态 + 配置提示」的字符串。
  },
  argumentHint: 'exclude "command pattern"',
// 参数提示：排除命令模式。
  get isHidden() {
// 隐藏判定 getter：不支持的平台或不在启用列表时隐藏命令。
    return (
      !SandboxManager.isSupportedPlatform() ||
      !SandboxManager.isPlatformInEnabledList()
    )
  },
  immediate: true,
// 设为立即执行命令（immediate），无需回车触发。
  type: 'local-jsx',
// 命令类型为本地 JSX 渲染。
  load: () => import('./sandbox-toggle.js'),
// 懒加载实际实现模块 sandbox-toggle.js。
} satisfies Command

export default command
