/**
 * User keybinding configuration loader with hot-reload support.
 *
 * Loads keybindings from ~/.claude/keybindings.json and watches
 * for changes to reload them automatically.
 *
 * NOTE: User keybinding customization is currently only available for
 * Anthropic employees (USER_TYPE === 'ant'). External users always
 * use the default bindings.
 */

// 热重载的骨架：文件监听交给第三方库，剩下的是缓存、去重与清理
import chokidar, { type FSWatcher } from 'chokidar'
import { readFileSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logEvent } from '../services/analytics/index.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { logForDebugging } from '../utils/debug.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { errorMessage, isENOENT } from '../utils/errors.js'
import { createSignal } from '../utils/signal.js'
import { jsonParse } from '../utils/slowOperations.js'
import { DEFAULT_BINDINGS } from './defaultBindings.js'
import { parseBindings } from './parser.js'
import type { KeybindingBlock, ParsedBinding } from './types.js'
import {
  checkDuplicateKeysInJson,
  type KeybindingWarning,
  validateBindings,
} from './validate.js'

// 定制开关单独导出一个判定函数，让诊断页与装载器共用同一个条件
/**
 * Check if keybinding customization is enabled.
 *
 * Returns true if the tengu_keybinding_customization_release GrowthBook gate is enabled.
 *
 * This function is exported so other parts of the codebase (e.g., /doctor)
 * can check the same condition consistently.
 */
// 只读缓存不阻塞：这个判定在渲染路径上被调用，不能等网络
export function isKeybindingCustomizationEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_keybinding_customization_release',
    false,
  )
}

/**
 * Time in milliseconds to wait for file writes to stabilize.
 */
// 写文件稳定阈值五百毫秒：编辑器保存常常先截断再写入，太早读会读到半截
const FILE_STABILITY_THRESHOLD_MS = 500

/**
 * Polling interval for checking file stability.
 */
// 轮询间隔两百毫秒：比阈值小一个量级，才能观察到稳定过程而不是错过窗口
const FILE_STABILITY_POLL_INTERVAL_MS = 200

/**
 * Result of loading keybindings, including any validation warnings.
 */
export type KeybindingsLoadResult = {
  bindings: ParsedBinding[]
  warnings: KeybindingWarning[]
}

// 模块级单例：监听器、初始化标志、缓存与事件通道都挂在模块上
let watcher: FSWatcher | null = null
let initialized = false
let disposed = false
let cachedBindings: ParsedBinding[] | null = null
let cachedWarnings: KeybindingWarning[] = []
// 变更事件通道的参数是一个装载结果：订阅者拿到的就是新的绑定与告警
const keybindingsChanged = createSignal<[result: KeybindingsLoadResult]>()

/**
 * Tracks the date (YYYY-MM-DD) when we last logged a custom keybindings load event.
 * Used to ensure we fire the event at most once per day.
 */
// 按天去重的时间戳：只记日期不记时间，跨零点自动重新放行
let lastCustomBindingsLogDate: string | null = null

/**
 * Log a telemetry event when custom keybindings are loaded, at most once per day.
 * This lets us estimate the percentage of users who customize their keybindings.
 */
// 同一天只报一次：想估的是有多少人定制过，不是他们保存了几次
function logCustomBindingsLoadedOncePerDay(userBindingCount: number): void {
  const today = new Date().toISOString().slice(0, 10)
  if (lastCustomBindingsLogDate === today) return
  lastCustomBindingsLogDate = today
  logEvent('tengu_custom_keybindings_loaded', {
    user_binding_count: userBindingCount,
  })
}

/**
 * Type guard to check if an object is a valid KeybindingBlock.
 */
function isKeybindingBlock(obj: unknown): obj is KeybindingBlock {
  if (typeof obj !== 'object' || obj === null) return false
  const b = obj as Record<string, unknown>
  return (
    typeof b.context === 'string' &&
    typeof b.bindings === 'object' &&
    b.bindings !== null
  )
}

/**
 * Type guard to check if an array contains only valid KeybindingBlocks.
 */
function isKeybindingBlockArray(arr: unknown): arr is KeybindingBlock[] {
  return Array.isArray(arr) && arr.every(isKeybindingBlock)
}

/**
 * Get the path to the user keybindings file.
 */
// 路径固定在家目录下的 keybindings.json，不允许用户指定别处
export function getKeybindingsPath(): string {
  return join(getClaudeConfigHomeDir(), 'keybindings.json')
}

/**
 * Parse default bindings (cached for performance).
 */
// 默认绑定每次重新解析而不缓存：解析本身很轻，缓存反而要多管一份失效
function getDefaultParsedBindings(): ParsedBinding[] {
  return parseBindings(DEFAULT_BINDINGS)
}

/**
 * Load and parse keybindings from user config file.
 * Returns merged default + user bindings along with validation warnings.
 *
 * For external users, always returns default bindings only.
 * User customization is currently gated to Anthropic employees.
 */
// 异步装载：先拿默认绑定守住底线，任何失败路径都退回它
export async function loadKeybindings(): Promise<KeybindingsLoadResult> {
  const defaultBindings = getDefaultParsedBindings()

  // Skip user config loading for external users
// 开关未开就直接返回默认值：外部用户根本不会去读那个文件
  if (!isKeybindingCustomizationEnabled()) {
    return { bindings: defaultBindings, warnings: [] }
  }

  const userPath = getKeybindingsPath()

  try {
    const content = await readFile(userPath, 'utf-8')
    const parsed: unknown = jsonParse(content)

    // Extract bindings array from object wrapper format: { "bindings": [...] }
    let userBlocks: unknown
// 外层可以包成对象也可以直接是数组，两种形状都在这里兼容
    if (typeof parsed === 'object' && parsed !== null && 'bindings' in parsed) {
      userBlocks = (parsed as { bindings: unknown }).bindings
    } else {
      // Invalid format - missing bindings property
// 缺少绑定数组是格式错误，给出可以直接照抄的示例而不是只说错了
      const errorMessage = 'keybindings.json must have a "bindings" array'
      const suggestion = 'Use format: { "bindings": [ ... ] }'
      logForDebugging(`[keybindings] Invalid keybindings.json: ${errorMessage}`)
      return {
        bindings: defaultBindings,
        warnings: [
          {
            type: 'parse_error',
            severity: 'error',
            message: errorMessage,
            suggestion,
          },
        ],
      }
    }

    // Validate structure - bindings must be an array of valid keybinding blocks
// 结构校验分两层：先确认是数组，再确认每块的上下文与绑定表都在
    if (!isKeybindingBlockArray(userBlocks)) {
      const errorMessage = !Array.isArray(userBlocks)
        ? '"bindings" must be an array'
        : 'keybindings.json contains invalid block structure'
      const suggestion = !Array.isArray(userBlocks)
        ? 'Set "bindings" to an array of keybinding blocks'
        : 'Each block must have "context" (string) and "bindings" (object)'
      logForDebugging(`[keybindings] Invalid keybindings.json: ${errorMessage}`)
      return {
        bindings: defaultBindings,
        warnings: [
          {
            type: 'parse_error',
            severity: 'error',
            message: errorMessage,
            suggestion,
          },
        ],
      }
    }

// 用户绑定解析成功后才进入合并，解析失败的路径上面已经各自返回了
    const userParsed = parseBindings(userBlocks)
    logForDebugging(
      `[keybindings] Loaded ${userParsed.length} user bindings from ${userPath}`,
    )

    // User bindings come after defaults, so they override
// 默认在前用户在后：后写的覆盖先写的，这就是用户定制的生效方式
    const mergedBindings = [...defaultBindings, ...userParsed]

    logCustomBindingsLoadedOncePerDay(userParsed.length)

    // Run validation on user config
    // First check for duplicate keys in raw JSON (JSON.parse silently drops earlier values)
// 重复键要在原始文本上查，因为解析后已经丢了信息
    const duplicateKeyWarnings = checkDuplicateKeysInJson(content)
    const warnings = [
      ...duplicateKeyWarnings,
      ...validateBindings(userBlocks, mergedBindings),
    ]

    if (warnings.length > 0) {
      logForDebugging(
        `[keybindings] Found ${warnings.length} validation issue(s)`,
      )
    }

    return { bindings: mergedBindings, warnings }
  } catch (error) {
    // File doesn't exist - use defaults (user can run /keybindings to create)
// before
    if (isENOENT(error)) {
      return { bindings: defaultBindings, warnings: [] }
    }

    // Other error - log and return defaults with warning
    logForDebugging(
      `[keybindings] Error loading ${userPath}: ${errorMessage(error)}`,
    )
    return {
      bindings: defaultBindings,
      warnings: [
        {
          type: 'parse_error',
          severity: 'error',
          message: `Failed to parse keybindings.json: ${errorMessage(error)}`,
        },
      ],
    }
  }
}

/**
 * Load keybindings synchronously (for initial render).
 * Uses cached value if available.
 */
// 同步版本给首屏渲染用：此时还来不及等异步装载
export function loadKeybindingsSync(): ParsedBinding[] {
  if (cachedBindings) {
    return cachedBindings
  }

  const result = loadKeybindingsSyncWithWarnings()
  return result.bindings
}

/**
 * Load keybindings synchronously with validation warnings.
 * Uses cached values if available.
 *
 * For external users, always returns default bindings only.
 * User customization is currently gated to Anthropic employees.
 */
// 同步版本的告警也一起缓存，避免重复读盘与重复校验
export function loadKeybindingsSyncWithWarnings(): KeybindingsLoadResult {
  if (cachedBindings) {
    return { bindings: cachedBindings, warnings: cachedWarnings }
  }

  const defaultBindings = getDefaultParsedBindings()

  // Skip user config loading for external users
  if (!isKeybindingCustomizationEnabled()) {
    cachedBindings = defaultBindings
    cachedWarnings = []
    return { bindings: cachedBindings, warnings: cachedWarnings }
  }

  const userPath = getKeybindingsPath()

  try {
    // sync IO: called from sync context (React useState initializer)
// 同步读有明确理由：调用方是状态初始化函数，只能同步
    const content = readFileSync(userPath, 'utf-8')
    const parsed: unknown = jsonParse(content)

    // Extract bindings array from object wrapper format: { "bindings": [...] }
    let userBlocks: unknown
    if (typeof parsed === 'object' && parsed !== null && 'bindings' in parsed) {
      userBlocks = (parsed as { bindings: unknown }).bindings
    } else {
      // Invalid format - missing bindings property
      cachedBindings = defaultBindings
      cachedWarnings = [
        {
          type: 'parse_error',
          severity: 'error',
          message: 'keybindings.json must have a "bindings" array',
          suggestion: 'Use format: { "bindings": [ ... ] }',
        },
      ]
      return { bindings: cachedBindings, warnings: cachedWarnings }
    }

    // Validate structure - bindings must be an array of valid keybinding blocks
    if (!isKeybindingBlockArray(userBlocks)) {
      const errorMessage = !Array.isArray(userBlocks)
        ? '"bindings" must be an array'
        : 'keybindings.json contains invalid block structure'
      const suggestion = !Array.isArray(userBlocks)
        ? 'Set "bindings" to an array of keybinding blocks'
        : 'Each block must have "context" (string) and "bindings" (object)'
      cachedBindings = defaultBindings
      cachedWarnings = [
        {
          type: 'parse_error',
          severity: 'error',
          message: errorMessage,
          suggestion,
        },
      ]
      return { bindings: cachedBindings, warnings: cachedWarnings }
    }

    const userParsed = parseBindings(userBlocks)
    logForDebugging(
      `[keybindings] Loaded ${userParsed.length} user bindings from ${userPath}`,
    )
// 合并结果写进缓存，后续首屏渲染直接命中
    cachedBindings = [...defaultBindings, ...userParsed]

    logCustomBindingsLoadedOncePerDay(userParsed.length)

    // Run validation - check for duplicate keys in raw JSON first
    const duplicateKeyWarnings = checkDuplicateKeysInJson(content)
    cachedWarnings = [
      ...duplicateKeyWarnings,
      ...validateBindings(userBlocks, cachedBindings),
    ]
    if (cachedWarnings.length > 0) {
      logForDebugging(
        `[keybindings] Found ${cachedWarnings.length} validation issue(s)`,
      )
    }

    return { bindings: cachedBindings, warnings: cachedWarnings }
  } catch {
// before
    // File doesn't exist or error - use defaults (user can run /keybindings to create)
    cachedBindings = defaultBindings
    cachedWarnings = []
    return { bindings: cachedBindings, warnings: cachedWarnings }
  }
}

/**
 * Initialize file watching for keybindings.json.
 * Call this once when the app starts.
 *
 * For external users, this is a no-op since user customization is disabled.
 */
// 监听初始化：已经初始化或已销毁就直接返回，保证幂等
export async function initializeKeybindingWatcher(): Promise<void> {
  if (initialized || disposed) return

  // Skip file watching for external users
  if (!isKeybindingCustomizationEnabled()) {
    logForDebugging(
      '[keybindings] Skipping file watcher - user customization disabled',
    )
    return
  }

  const userPath = getKeybindingsPath()
// 监听目录而不是文件本身：文件被删掉再重建时，只监听文件会失去后续事件
  const watchDir = dirname(userPath)

  // Only watch if parent directory exists
// 目录必须存在才能监听，不存在就放弃并把原因写进调试日志
  try {
    const stats = await stat(watchDir)
    if (!stats.isDirectory()) {
      logForDebugging(
        `[keybindings] Not watching: ${watchDir} is not a directory`,
      )
      return
    }
  } catch {
    logForDebugging(`[keybindings] Not watching: ${watchDir} does not exist`)
    return
  }

  // Set initialized only after we've confirmed we can watch
// 确认可以监听之后才置初始化标志，避免失败时留下永远不再重试的状态
  initialized = true

  logForDebugging(`[keybindings] Watching for changes to ${userPath}`)

// 监听参数：忽略初始事件、等写入稳定、文件被替换时按原子操作处理
  watcher = chokidar.watch(userPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: FILE_STABILITY_THRESHOLD_MS,
      pollInterval: FILE_STABILITY_POLL_INTERVAL_MS,
    },
    ignorePermissionErrors: true,
    usePolling: false,
    atomic: true,
  })

// 新增与修改走同一条重载路径，删除单独处理
  watcher.on('add', handleChange)
  watcher.on('change', handleChange)
  watcher.on('unlink', handleDelete)

  // Register cleanup
// 把销毁函数注册进全局清理，进程退出时不留下监听句柄
  registerCleanup(async () => disposeKeybindingWatcher())
}

/**
 * Clean up the file watcher.
 */
// 销毁：先置标志再关监听，置标志能挡住正在排队的回调
export function disposeKeybindingWatcher(): void {
  disposed = true
  if (watcher) {
    void watcher.close()
    watcher = null
  }
  keybindingsChanged.clear()
}

/**
 * Subscribe to keybinding changes.
 * The listener receives the new parsed bindings when the file changes.
 */
export const subscribeToKeybindingChanges = keybindingsChanged.subscribe

// 重载成功才更新缓存并广播，失败只记日志保留旧绑定
async function handleChange(path: string): Promise<void> {
  logForDebugging(`[keybindings] Detected change to ${path}`)

  try {
    const result = await loadKeybindings()
    cachedBindings = result.bindings
    cachedWarnings = result.warnings

    // Notify all listeners with the full result
    keybindingsChanged.emit(result)
  } catch (error) {
    logForDebugging(`[keybindings] Error reloading: ${errorMessage(error)}`)
  }
}

// 文件被删就退回默认绑定并广播一次，让界面立刻反映
function handleDelete(path: string): void {
  logForDebugging(`[keybindings] Detected deletion of ${path}`)

  // Reset to defaults when file is deleted
  const defaultBindings = getDefaultParsedBindings()
  cachedBindings = defaultBindings
  cachedWarnings = []

  keybindingsChanged.emit({ bindings: defaultBindings, warnings: [] })
}

/**
 * Get the cached keybinding warnings.
 * Returns empty array if no warnings or bindings haven't been loaded yet.
 */
// 告警缓存对外只读，供诊断页在装载后随时取用
export function getCachedKeybindingWarnings(): KeybindingWarning[] {
  return cachedWarnings
}

/**
 * Reset internal state for testing.
 */
// 测试用的重置：把模块级变量全部归位，包括按天去重的时间戳
export function resetKeybindingLoaderForTesting(): void {
  initialized = false
  disposed = false
  cachedBindings = null
  cachedWarnings = []
  lastCustomBindingsLogDate = null
  if (watcher) {
    void watcher.close()
    watcher = null
  }
  keybindingsChanged.clear()
}
