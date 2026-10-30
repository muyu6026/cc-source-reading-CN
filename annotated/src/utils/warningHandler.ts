import { posix, win32 } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
// 全局警告处理器：拦截 Node 的 warning 事件，对外部用户隐藏警告、把内部警告上报到 Statsig 用于监控，并对告警键做有界计数防止内存膨胀。
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { getPlatform } from './platform.js'

// MAX_WARNING_KEYS 与 warningCounts：告警键上限与计数表，超过上限后不再追踪新键（其出现次数在遥测中固定记为 1）。
// Track warnings to avoid spam — bounded to prevent unbounded memory growth
export const MAX_WARNING_KEYS = 1000
const warningCounts = new Map<string, number>()

// Check if running from a build directory (development mode)
// This is a sync version of the logic in getCurrentInstallationType()
function isRunningFromBuildDirectory(): boolean {
  let invokedPath = process.argv[1] || ''
  let execPath = process.execPath || process.argv[0] || ''

  // On Windows, convert backslashes to forward slashes for consistent path matching
  if (getPlatform() === 'windows') {
    invokedPath = invokedPath.split(win32.sep).join(posix.sep)
    execPath = execPath.split(win32.sep).join(posix.sep)
  }

  const pathsToCheck = [invokedPath, execPath]
  const buildDirs = [
    '/build-ant/',
    '/build-external/',
    '/build-external-native/',
    '/build-ant-native/',
  ]

  return pathsToCheck.some(path => buildDirs.some(dir => path.includes(dir)))
}
// isRunningFromBuildDirectory：通过比对进程路径是否含构建目录特征串，同步判断当前是否运行于开发构建。

// Warnings we know about and want to suppress from users
const INTERNAL_WARNINGS = [
  /MaxListenersExceededWarning.*AbortSignal/,
  /MaxListenersExceededWarning.*EventTarget/,
]

function isInternalWarning(warning: Error): boolean {
  const warningStr = `${warning.name}: ${warning.message}`
  return INTERNAL_WARNINGS.some(pattern => pattern.test(warningStr))
}
// isInternalWarning：把警告名与消息拼成字符串，匹配已知内部告警模式（如 AbortSignal 监听器超限）。

// Store reference to our warning handler so we can detect if it's already installed
let warningHandler: ((warning: Error) => void) | null = null

// For testing only - allows resetting the warning handler state
export function resetWarningHandler(): void {
  if (warningHandler) {
    process.removeListener('warning', warningHandler)
  }
  warningHandler = null
  warningCounts.clear()
}
// resetWarningHandler：仅供测试，移除已安装的处理器并清空计数与状态。

export function initializeWarningHandler(): void {
// initializeWarningHandler 签名：安装全局警告处理器，避免重复安装。
  // Only set up handler once - check if our handler is already installed
  const currentListeners = process.listeners('warning')
  if (warningHandler && currentListeners.includes(warningHandler)) {
    return
  }

  // For external users, remove default Node.js handler to suppress stderr output
  // For internal users, only keep default warnings for development builds
  // Check development mode directly to avoid async call in init
  // This preserves the same logic as getCurrentInstallationType() without async
  const isDevelopment =
    process.env.NODE_ENV === 'development' || isRunningFromBuildDirectory()
  if (!isDevelopment) {
    process.removeAllListeners('warning')
  }
// 非开发模式下移除 Node 默认警告处理器，对外部用户屏蔽 stderr 警告输出。

  // Create and store our warning handler
  warningHandler = (warning: Error) => {
    try {
      const warningKey = `${warning.name}: ${warning.message.slice(0, 50)}`
      const count = warningCounts.get(warningKey) || 0

      // Bound the map to prevent unbounded memory growth from unique warning keys.
      // Once the cap is reached, new unique keys are not tracked — their
      // occurrence_count will always be reported as 1 in analytics.
      if (
        warningCounts.has(warningKey) ||
        warningCounts.size < MAX_WARNING_KEYS
      ) {
        warningCounts.set(warningKey, count + 1)
      }

      const isInternal = isInternalWarning(warning)

      // Always log to Statsig for monitoring
      // Include full details for ant users only, since they may contain code or filepaths
      logEvent('tengu_node_warning', {
        is_internal: isInternal ? 1 : 0,
        occurrence_count: count + 1,
        classname:
          warning.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(process.env.USER_TYPE === 'ant' && {
          message:
            warning.message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
      })

      // In debug mode, show all warnings with context
      if (isEnvTruthy(process.env.CLAUDE_DEBUG)) {
        const prefix = isInternal ? '[Internal Warning]' : '[Warning]'
        logForDebugging(`${prefix} ${warning.toString()}`, { level: 'warn' })
      }
      // Hide all warnings from users - they are only logged to Statsig for monitoring
    } catch {
      // Fail silently - we don't want the warning handler to cause issues
    }
  }

  // Install the warning handler
// initializeWarningHandler 收尾：把自定义处理器挂到 process 的 warning 事件上，内部告警上报 Statsig，调试模式另打印到日志。
  process.on('warning', warningHandler)
}
