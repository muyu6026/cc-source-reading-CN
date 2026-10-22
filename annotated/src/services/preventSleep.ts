/**
 * Prevents macOS from sleeping while Claude is working.
 *
 * Uses the built-in `caffeinate` command to create a power assertion that
 * prevents idle sleep. This keeps the Mac awake during API requests and
 * tool execution so long-running operations don't get interrupted.
 *
 * The caffeinate process is spawned with a timeout and periodically restarted.
 * This provides self-healing behavior: if the Node process is killed with
 * SIGKILL (which doesn't run cleanup handlers), the orphaned caffeinate will
 * automatically exit after the timeout expires.
 *
 * Only runs on macOS - no-op on other platforms.
 */
import { type ChildProcess, spawn } from 'child_process'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { logForDebugging } from '../utils/debug.js'

// Caffeinate timeout in seconds. Process auto-exits after this duration.
// We restart it before expiry to maintain continuous sleep prevention.
const CAFFEINATE_TIMEOUT_SECONDS = 300 // 5 minutes
// 整个模块最关键的参数组合：**5 分钟超时 + 4 分钟重启**。`caffeinate -t 300` 让子进程自己在 5 分钟后退出，外面的定时器每 4 分钟换一个新的。这不是冗余，是**自愈设计**——Node 被 `SIGKILL` 打死时（`kill -9`、OOM killer、关机脚本）不一定有机会跑清理函数，那时这个孤儿 `caffeinate` 最多再撑 5 分钟就自己消失，不会永久霸占电源断言。留 1 分钟 buffer 是给「重启动作本身耗时」的，避免两次 spawn 之间出现空窗期。

// Restart interval - restart caffeinate before it expires.
// Use 4 minutes to give plenty of buffer before the 5 minute timeout.
const RESTART_INTERVAL_MS = 4 * 60 * 1000

let caffeinateProcess: ChildProcess | null = null
let restartInterval: ReturnType<typeof setInterval> | null = null
let refCount = 0
// `refCount` 引用计数：同一时刻可能有多个长任务在跑（一个在等 API、一个在执行 Bash），谁都不该在别人还活着的时候放行休眠。所以是「计数归 1 时启动、归 0 时停止」，而不是每次调用都 spawn 一个 `caffeinate`（那会攒出一堆进程）。
let cleanupRegistered = false

/**
 * Increment the reference count and start preventing sleep if needed.
 * Call this when starting work that should keep the Mac awake.
 */
export function startPreventSleep(): void {
  refCount++

// 只在 **0 → 1** 这一跳启动。`refCount === 1` 而不是 `> 0`：后者每次调用都会重新 spawn 一遍（虽然 `spawnCaffeinate` 内部有非空判断挡着，但重启定时器会被反复创建）。
  if (refCount === 1) {
    spawnCaffeinate()
    startRestartInterval()
  }
}

/**
 * Decrement the reference count and allow sleep if no more work is pending.
 * Call this when work completes.
 */
export function stopPreventSleep(): void {
  if (refCount > 0) {
    refCount--
  }

  if (refCount === 0) {
    stopRestartInterval()
    killCaffeinate()
  }
}

/**
 * Force stop preventing sleep, regardless of reference count.
 * Use this for cleanup on exit.
 */
export function forceStopPreventSleep(): void {
  refCount = 0
  stopRestartInterval()
  killCaffeinate()
}

function startRestartInterval(): void {
  // Only run on macOS
  if (process.platform !== 'darwin') {
    return
  }
// **非 macOS 整个模块是 no-op**：`spawnCaffeinate` 和 `startRestartInterval` 各自在入口判平台后静默返回。写在两个函数里而不是调用处，是为了让 `startPreventSleep`/`stopPreventSleep` 在 Windows/Linux 上也能被无条件调用——调用方不需要关心平台（引用计数照样增减，只是没有副作用）。

  // Already running
  if (restartInterval !== null) {
    return
  }

  restartInterval = setInterval(() => {
    // Only restart if we still need sleep prevention
    if (refCount > 0) {
      logForDebugging('Restarting caffeinate to maintain sleep prevention')
      killCaffeinate()
      spawnCaffeinate()
    }
  }, RESTART_INTERVAL_MS)

  // Don't let the interval keep the Node process alive
  restartInterval.unref()
// `unref()` 是双保险的一半：重启定时器**不能**成为阻止 Node 退出的原因（否则一个后台定时器会让 CLI 永远退不干净）。另一半在 `spawnCaffeinate` 里——子进程也要 `unref()`。两个都 unref 之后，Node 的存活只由真正的工作决定。
}

function stopRestartInterval(): void {
  if (restartInterval !== null) {
    clearInterval(restartInterval)
    restartInterval = null
  }
}

function spawnCaffeinate(): void {
  // Only run on macOS
  if (process.platform !== 'darwin') {
    return
  }

  // Already running
  if (caffeinateProcess !== null) {
    return
  }

  // Register cleanup on first use to ensure caffeinate is killed on exit
  if (!cleanupRegistered) {
    cleanupRegistered = true
    registerCleanup(async () => {
      forceStopPreventSleep()
    })
  }

  try {
    // -i: Create an assertion to prevent idle sleep
    //     This is the least aggressive option - display can still sleep
    // -t: Timeout in seconds - caffeinate exits automatically after this
    //     This provides self-healing if Node is killed with SIGKILL
    caffeinateProcess = spawn(
      'caffeinate',
      ['-i', '-t', String(CAFFEINATE_TIMEOUT_SECONDS)],
      {
        stdio: 'ignore',
      },
    )
// `-i` 和 `-t` 的含义值得记：`-i` 是「阻止**空闲休眠**」的断言，但**不阻止显示器休眠**（比 `-d`/`-s` 温和，屏幕该黑还黑，只是机器不睡）；`-t` 是秒级超时，也是上面说的自愈开关。`stdio: 'ignore'` 避免它的输出混进 CLI 的终端渲染。

    // Don't let caffeinate keep the Node process alive
    caffeinateProcess.unref()

    const thisProc = caffeinateProcess
// `thisProc` 快照是**竞态防护**。`error`/`exit` 回调是异步触发的，回调里如果直接写 `caffeinateProcess = null`，就可能把**后来新 spawn 的那个进程引用**清掉——于是 `killCaffeinate` 再也杀不到它，它会一直跑到 5 分钟超时。所以回调里先比对 `caffeinateProcess === thisProc`：只清自己的引用。
    caffeinateProcess.on('error', err => {
      logForDebugging(`caffeinate spawn error: ${err.message}`)
      if (caffeinateProcess === thisProc) caffeinateProcess = null
    })

    caffeinateProcess.on('exit', () => {
      if (caffeinateProcess === thisProc) caffeinateProcess = null
    })

    logForDebugging('Started caffeinate to prevent sleep')
  } catch {
    // Silently fail - caffeinate not available or spawn failed
    caffeinateProcess = null
  }
}

function killCaffeinate(): void {
  if (caffeinateProcess !== null) {
    const proc = caffeinateProcess
    caffeinateProcess = null
    try {
      // SIGKILL for immediate termination - SIGTERM could be delayed
      proc.kill('SIGKILL')
// `SIGKILL` 而不是 `SIGTERM`：`caffeinate` 收到 `SIGTERM` 不保证立刻死（它可能在处理信号），而这个调用发生在「用户已经干完活了、想马上合盖走人」的时刻，多等几百毫秒都是体感问题。杀掉它没有资源需要优雅释放。
      logForDebugging('Stopped caffeinate, allowing sleep')
    } catch {
      // Process may have already exited
    }
  }
}
