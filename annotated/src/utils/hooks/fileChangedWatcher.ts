// 文件级：用 chokidar 监听 cwd 下由 FileChanged 钩子匹配的文件变化，触发钩子执行并把结果通知给 UI；同时处理切换工作目录（CwdChanged）时的重算。
import chokidar, { type FSWatcher } from 'chokidar'
import { isAbsolute, join } from 'path'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import {
  executeCwdChangedHooks,
  executeFileChangedHooks,
  type HookOutsideReplResult,
} from '../hooks.js'
import { clearCwdEnvFiles } from '../sessionEnvironment.js'
import { getHooksConfigFromSnapshot } from './hooksConfigSnapshot.js'

let watcher: FSWatcher | null = null
let currentCwd: string
let dynamicWatchPaths: string[] = []
let dynamicWatchPathsSorted: string[] = []
let initialized = false
let hasEnvHooks = false
let notifyCallback: ((text: string, isError: boolean) => void) | null = null
// 模块级状态：watcher 持有 chokidar 实例，currentCwd 记录当前目录，dynamicWatchPaths / dynamicWatchPathsSorted 收集并缓存钩子运行期动态返回的额外监听路径。

export function setEnvHookNotifier(
  cb: ((text: string, isError: boolean) => void) | null,
): void {
  notifyCallback = cb
}
// setEnvHookNotifier：注入一个回调，用于把钩子产生的系统消息或错误回显到 UI。

export function initializeFileChangedWatcher(cwd: string): void {
  if (initialized) return
  initialized = true
  currentCwd = cwd

  const config = getHooksConfigFromSnapshot()
  hasEnvHooks =
    (config?.CwdChanged?.length ?? 0) > 0 ||
    (config?.FileChanged?.length ?? 0) > 0

  if (hasEnvHooks) {
    registerCleanup(async () => dispose())
  }

  const paths = resolveWatchPaths(config)
  if (paths.length === 0) return

  startWatching(paths)
}
// initializeFileChangedWatcher：仅初始化一次；根据快照判断是否含有 env 钩子，若有则注册清理函数，解析监听路径后启动监听。

function resolveWatchPaths(
  config?: ReturnType<typeof getHooksConfigFromSnapshot>,
): string[] {
  const matchers = (config ?? getHooksConfigFromSnapshot())?.FileChanged ?? []

  // Matcher field: filenames to watch in cwd, pipe-separated (e.g. ".envrc|.env")
  const staticPaths: string[] = []
  for (const m of matchers) {
    if (!m.matcher) continue
    for (const name of m.matcher.split('|').map(s => s.trim())) {
      if (!name) continue
      staticPaths.push(isAbsolute(name) ? name : join(currentCwd, name))
    }
  }

  // Combine static matcher paths with dynamic paths from hook output
  return [...new Set([...staticPaths, ...dynamicWatchPaths])]
}
// resolveWatchPaths：把 FileChanged 匹配器里的文件名（竖线分隔）与动态路径合并去重，绝对路径原样、相对路径拼到 currentCwd。

function startWatching(paths: string[]): void {
  logForDebugging(`FileChanged: watching ${paths.length} paths`)
  watcher = chokidar.watch(paths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
    ignorePermissionErrors: true,
  })
  watcher.on('change', p => handleFileEvent(p, 'change'))
  watcher.on('add', p => handleFileEvent(p, 'add'))
  watcher.on('unlink', p => handleFileEvent(p, 'unlink'))
}
// startWatching：用 chokidar 监听，忽略初始事件、写完成后稳定 500ms 再触发，绑定 change / add / unlink 三类事件到统一处理函数。

function handleFileEvent(
  path: string,
  event: 'change' | 'add' | 'unlink',
): void {
  logForDebugging(`FileChanged: ${event} ${path}`)
  void executeFileChangedHooks(path, event)
    .then(({ results, watchPaths, systemMessages }) => {
      if (watchPaths.length > 0) {
        updateWatchPaths(watchPaths)
      }
      for (const msg of systemMessages) {
        notifyCallback?.(msg, false)
      }
      for (const r of results) {
        if (!r.succeeded && r.output) {
          notifyCallback?.(r.output, true)
        }
      }
    })
    .catch(e => {
      const msg = errorMessage(e)
      logForDebugging(`FileChanged hook failed: ${msg}`, {
        level: 'error',
      })
      notifyCallback?.(msg, true)
    })
}
// handleFileEvent：执行 FileChanged 钩子，根据返回更新监听路径、把系统消息与失败输出通过回调通知 UI，异常也归一到回调。

export function updateWatchPaths(paths: string[]): void {
  if (!initialized) return
  const sorted = paths.slice().sort()
  if (
    sorted.length === dynamicWatchPathsSorted.length &&
    sorted.every((p, i) => p === dynamicWatchPathsSorted[i])
  ) {
    return
  }
  dynamicWatchPaths = paths
  dynamicWatchPathsSorted = sorted
  restartWatching()
}
// updateWatchPaths：若动态路径集合发生变化则更新缓存并重启监听，避免无谓重建。

function restartWatching(): void {
  if (watcher) {
    void watcher.close()
    watcher = null
  }
  const paths = resolveWatchPaths()
  if (paths.length > 0) {
    startWatching(paths)
  }
}
// restartWatching：关闭旧 watcher 后按最新路径重新监听。

export async function onCwdChangedForHooks(
  oldCwd: string,
  newCwd: string,
): Promise<void> {
  if (oldCwd === newCwd) return

  // Re-evaluate from the current snapshot so mid-session hook changes are picked up
  const config = getHooksConfigFromSnapshot()
  const currentHasEnvHooks =
    (config?.CwdChanged?.length ?? 0) > 0 ||
    (config?.FileChanged?.length ?? 0) > 0
  if (!currentHasEnvHooks) return
  currentCwd = newCwd

  await clearCwdEnvFiles()
  const hookResult = await executeCwdChangedHooks(oldCwd, newCwd).catch(e => {
    const msg = errorMessage(e)
    logForDebugging(`CwdChanged hook failed: ${msg}`, {
      level: 'error',
    })
    notifyCallback?.(msg, true)
    return {
      results: [] as HookOutsideReplResult[],
      watchPaths: [] as string[],
      systemMessages: [] as string[],
    }
  })
  dynamicWatchPaths = hookResult.watchPaths
  dynamicWatchPathsSorted = hookResult.watchPaths.slice().sort()
  for (const msg of hookResult.systemMessages) {
    notifyCallback?.(msg, false)
  }
  for (const r of hookResult.results) {
    if (!r.succeeded && r.output) {
      notifyCallback?.(r.output, true)
    }
  }

  // Re-resolve matcher paths against the new cwd
  if (initialized) {
    restartWatching()
  }
}
// onCwdChangedForHooks：工作目录切换时重算钩子配置、清理旧 cwd 的环境文件、执行 CwdChanged 钩子，并据返回刷新动态监听路径后重启监听。

function dispose(): void {
  if (watcher) {
    void watcher.close()
    watcher = null
  }
  dynamicWatchPaths = []
  dynamicWatchPathsSorted = []
  initialized = false
  hasEnvHooks = false
  notifyCallback = null
}
// dispose：关闭 watcher、清空所有模块级状态，供清理注册与测试重置复用。

export function resetFileChangedWatcherForTesting(): void {
  dispose()
}
// resetFileChangedWatcherForTesting：测试用入口，直接调用 dispose 复位全部状态。
