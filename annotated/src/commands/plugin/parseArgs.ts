// 把插件子命令参数解析为结构化的 ParsedCommand。
// Parse plugin subcommand arguments into structured commands
// 插件子命令的联合类型：菜单/帮助/安装/管理/卸载/启用/禁用/校验/市场。
export type ParsedCommand =
  | { type: 'menu' }
  | { type: 'help' }
  | { type: 'install'; marketplace?: string; plugin?: string }
  | { type: 'manage' }
  | { type: 'uninstall'; plugin?: string }
  | { type: 'enable'; plugin?: string }
  | { type: 'disable'; plugin?: string }
  | { type: 'validate'; path?: string }
  | {
      type: 'marketplace'
      action?: 'add' | 'remove' | 'update' | 'list'
      target?: string
    }

// 插件参数解析入口函数。
export function parsePluginArgs(args?: string): ParsedCommand {
  if (!args) {
    return { type: 'menu' }
// 无参数时直接回菜单。
  }

  const parts = args.trim().split(/\s+/)
// 按空白拆分参数并取首个小写命令词。
  const command = parts[0]?.toLowerCase()

  switch (command) {
// switch 分发各子命令。
    case 'help':
    case '--help':
    case '-h':
      return { type: 'help' }

    case 'install':
// install/i：解析目标，区分插件与 marketplace。
    case 'i': {
      const target = parts[1]
      if (!target) {
        return { type: 'install' }
      }

      // Check if it's in format plugin@marketplace
      if (target.includes('@')) {
// 含 @ 的写法拆出 plugin 与 marketplace。
        const [plugin, marketplace] = target.split('@')
        return { type: 'install', plugin, marketplace }
      }

      // Check if the target looks like a marketplace (URL or path)
      const isMarketplace =
        target.startsWith('http://') ||
        target.startsWith('https://') ||
        target.startsWith('file://') ||
        target.includes('/') ||
        target.includes('\\')
// 以 URL/路径特征判断目标是否为 marketplace（多行赋值收尾后注解）。

      if (isMarketplace) {
        // This is a marketplace URL/path, no plugin specified
        return { type: 'install', marketplace: target }
      }

      // Otherwise treat it as a plugin name
      return { type: 'install', plugin: target }
// 无 @ 且非路径则视为插件名。
    }

    case 'manage':
// manage 子命令。
      return { type: 'manage' }

    case 'uninstall':
// uninstall/enable/disable：取第二个参数为插件名。
      return { type: 'uninstall', plugin: parts[1] }

    case 'enable':
      return { type: 'enable', plugin: parts[1] }

    case 'disable':
      return { type: 'disable', plugin: parts[1] }

    case 'validate': {
// validate：拼接剩余参数为待校验路径。
      const target = parts.slice(1).join(' ').trim()
      return { type: 'validate', path: target || undefined }
    }

    case 'marketplace':
// marketplace/market：分发 add/remove/update/list。
    case 'market': {
      const action = parts[1]?.toLowerCase()
      const target = parts.slice(2).join(' ')

      switch (action) {
        case 'add':
          return { type: 'marketplace', action: 'add', target }
        case 'remove':
        case 'rm':
          return { type: 'marketplace', action: 'remove', target }
        case 'update':
          return { type: 'marketplace', action: 'update', target }
        case 'list':
          return { type: 'marketplace', action: 'list' }
        default:
          // No action specified, show marketplace menu
          return { type: 'marketplace' }
      }
    }

    default:
// 未知命令回退到菜单。
      // Unknown command, show menu
      return { type: 'menu' }
  }
}
