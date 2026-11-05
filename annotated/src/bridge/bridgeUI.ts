import chalk from 'chalk'
import { toString as qrToString } from 'qrcode'
import {
  BRIDGE_FAILED_INDICATOR,
  BRIDGE_READY_INDICATOR,
  BRIDGE_SPINNER_FRAMES,
} from '../constants/figures.js'
import { stringWidth } from '../ink/stringWidth.js'
import { logForDebugging } from '../utils/debug.js'
import {
  buildActiveFooterText,
  buildBridgeConnectUrl,
  buildBridgeSessionUrl,
  buildIdleFooterText,
  FAILED_FOOTER_TEXT,
  formatDuration,
  type StatusState,
  TOOL_DISPLAY_EXPIRY_MS,
  timestamp,
  truncatePrompt,
  wrapWithOsc8Link,
} from './bridgeStatusUtil.js'
import type {
  BridgeConfig,
  BridgeLogger,
  SessionActivity,
  SpawnMode,
} from './types.js'

// 二维码按最小体积出：容错级别最低、用紧凑模式，因为它只占状态区几行
const QR_OPTIONS = {
  type: 'utf8' as const,
  errorCorrectionLevel: 'L' as const,
  small: true,
}

/** Generate a QR code and return its lines. */
// 生成后按行切分并去掉空行，行数组直接作为状态行往上贴
async function generateQr(url: string): Promise<string[]> {
  const qr = await qrToString(url, QR_OPTIONS)
  return qr.split('\n').filter((line: string) => line.length > 0)
}

// 日志器是工厂函数而不是类：内部状态全在闭包里，写出口可以注入以便测试
export function createBridgeLogger(options: {
  verbose: boolean
  write?: (s: string) => void
}): BridgeLogger {
// 写出口默认为标准输出，测试时换成收集器就能断言排版
  const write = options.write ?? ((s: string) => process.stdout.write(s))
  const verbose = options.verbose

  // Track how many status lines are currently displayed at the bottom
// 状态区当前占了几个可视行——所有刷新都靠这个数字回到起点
  let statusLineCount = 0

  // Status state machine
// 状态机：当前状态、状态文案、仓库名、分支名、调试日志路径
  let currentState: StatusState = 'idle'
  let currentStateText = 'Ready'
  let repoName = ''
  let branch = ''
  let debugLogPath = ''

  // Connect URL (built in printBanner with correct base for staging/prod)
  let connectUrl = ''
  let cachedIngressUrl = ''
  let cachedEnvironmentId = ''
  let activeSessionUrl: string | null = null

  // QR code lines for the current URL
// 二维码内容与是否显示分开存：隐藏时仍保留内容，切换无需重新生成
  let qrLines: string[] = []
  let qrVisible = false

  // Tool activity for the second status line
// 工具活动单独一行，带时间戳用于过期判断
  let lastToolSummary: string | null = null
  let lastToolTime = 0

  // Session count indicator (shown when multi-session mode is enabled)
// 并发会话计数，以及会话生成模式——它同时决定提示里要不要显示分支
  let sessionActive = 0
  let sessionMax = 1
  // Spawn mode shown in the session-count line + gates the `w` hint
  let spawnModeDisplay: 'same-dir' | 'worktree' | null = null
  let spawnMode: SpawnMode = 'single-session'

  // Per-session display info for the multi-session bullet list (keyed by compat sessionId)
// 多会话时的逐条展示信息，键是兼容格式的会话标识
  const sessionDisplayInfo = new Map<
    string,
    { title?: string; url: string; activity?: SessionActivity }
  >()

  // Connecting spinner state
// 连接中的转圈由定时器推进，与状态机的其他状态互斥
  let connectingTimer: ReturnType<typeof setInterval> | null = null
  let connectingTick = 0

  /**
   * Count how many visual terminal rows a string occupies, accounting for
   * line wrapping. Each `\n` is one row, and content wider than the terminal
   * wraps to additional rows.
   */
// 算一段文本占几个终端行：换行算一行，超宽的部分按列数向上取整
  function countVisualLines(text: string): number {
    // eslint-disable-next-line custom-rules/prefer-use-terminal-size
// 这里不是组件环境，拿不到终端尺寸钩子，只能读标准输出的列数并给个八十的兜底
    const cols = process.stdout.columns || 80 // non-React CLI context
    let count = 0
    // Split on newlines to get logical lines
    for (const logical of text.split('\n')) {
      if (logical.length === 0) {
        // Empty segment between consecutive \n — counts as 1 row
        count++
        continue
      }
// 宽度要按显示宽度算而不是字符数：中文与表情符号占两列
      const width = stringWidth(logical)
      count += Math.max(1, Math.ceil(width / cols))
    }
    // The trailing \n in "line\n" produces an empty last element — don't count it
    // because the cursor sits at the start of the next line, not a new visual row.
// 结尾换行会多切出一个空段，但光标其实停在下一行行首，不算一个新可视行
    if (text.endsWith('\n')) {
      count--
    }
    return count
  }

  /** Write a status line and track its visual line count. */
// 写一行并记账：状态区的行数是累加出来的，不能靠数换行符
  function writeStatus(text: string): void {
    write(text)
    statusLineCount += countVisualLines(text)
  }

  /** Clear any currently displayed status lines. */
// 清状态区：没有内容就什么都不做，避免发出无意义的控制序列
  function clearStatusLines(): void {
    if (statusLineCount <= 0) return
    logForDebugging(`[bridge:ui] clearStatusLines count=${statusLineCount}`)
    // Move cursor up to the start of the status block, then erase everything below
// 先把光标上移整块高度，再从光标处清到屏幕末尾——两步合起来才是干净的擦除
    write(`\x1b[${statusLineCount}A`) // cursor up N lines
    write('\x1b[J') // erase from cursor to end of screen
    statusLineCount = 0
  }

  /** Print a permanent log line, clearing status first and restoring after. */
// 打一条永久日志：先擦掉状态区，写完由下一次刷新重画
  function printLog(line: string): void {
    clearStatusLines()
    write(line)
  }

  /** Regenerate the QR code with the given URL. */
// 二维码重新生成是异步的，完成后主动重画一次
  function regenerateQr(url: string): void {
    generateQr(url)
      .then(lines => {
        qrLines = lines
        renderStatusLine()
      })
      .catch(e => {
        logForDebugging(`QR code generation failed: ${e}`, { level: 'error' })
      })
  }

  /** Render the connecting spinner line (shown before first updateIdleStatus). */
// 连接中的那一行：转圈帧按计数轮换，后面拼仓库与分支
  function renderConnectingLine(): void {
    clearStatusLines()

    const frame =
      BRIDGE_SPINNER_FRAMES[connectingTick % BRIDGE_SPINNER_FRAMES.length]!
    let suffix = ''
    if (repoName) {
      suffix += chalk.dim(' \u00b7 ') + chalk.dim(repoName)
    }
    if (branch) {
      suffix += chalk.dim(' \u00b7 ') + chalk.dim(branch)
    }
    writeStatus(
      `${chalk.yellow(frame)} ${chalk.yellow('Connecting')}${suffix}\n`,
    )
  }

  /** Start the connecting spinner. Stopped by first updateIdleStatus(). */
// 启动前先停旧的，避免重复定时器叠加出多个转圈
  function startConnecting(): void {
    stopConnecting()
    renderConnectingLine()
    connectingTimer = setInterval(() => {
      connectingTick++
      renderConnectingLine()
    }, 150)
  }

  /** Stop the connecting spinner. */
// 停止必须把句柄也置空，否则下一次判断会以为还在跑
  function stopConnecting(): void {
    if (connectingTimer) {
      clearInterval(connectingTimer)
      connectingTimer = null
    }
  }

  /** Render and write the current status lines based on state. */
// 主渲染：所有状态都从这里出，重连与失败两种状态例外
  function renderStatusLine(): void {
// 这两种状态由各自的函数负责绘制，这里提前返回而不是先擦后画——否则切换二维码这类小操作会把转圈或错误信息抹掉
    if (currentState === 'reconnecting' || currentState === 'failed') {
      // These states are handled separately (updateReconnectingStatus /
      // updateFailedStatus). Return before clearing so callers like toggleQr
      // and setSpawnModeDisplay don't blank the display during these states.
      return
    }

    clearStatusLines()

    const isIdle = currentState === 'idle'

    // QR code above the status line
// 二维码画在状态行上方，逐行暗淡输出
    if (qrVisible) {
      for (const line of qrLines) {
        writeStatus(`${chalk.dim(line)}\n`)
      }
    }

    // Determine indicator and colors based on state
// 就绪用绿色，忙碌用青色，只靠颜色区分而不改图标
    const indicator = BRIDGE_READY_INDICATOR
    const indicatorColor = isIdle ? chalk.green : chalk.cyan
    const baseColor = isIdle ? chalk.green : chalk.cyan
    const stateText = baseColor(currentStateText)

    // Build the suffix with repo and branch
    let suffix = ''
    if (repoName) {
      suffix += chalk.dim(' \u00b7 ') + chalk.dim(repoName)
    }
    // In worktree mode each session gets its own branch, so showing the
    // bridge's branch would be misleading.
// 工作树模式下每个会话有自己的分支，再显示桥接的分支会误导
    if (branch && spawnMode !== 'worktree') {
      suffix += chalk.dim(' \u00b7 ') + chalk.dim(branch)
    }

// 内部构建才显示调试日志路径，外部构建里这一行整段消失
    if (process.env.USER_TYPE === 'ant' && debugLogPath) {
      writeStatus(
        `${chalk.yellow('[ANT-ONLY] Logs:')} ${chalk.dim(debugLogPath)}\n`,
      )
    }
    writeStatus(`${indicatorColor(indicator)} ${stateText}${suffix}\n`)

    // Session count and per-session list (multi-session mode only)
// 多会话时状态行下面再加一段容量提示与逐会话清单
    if (sessionMax > 1) {
      const modeHint =
        spawnMode === 'worktree'
          ? 'New sessions will be created in an isolated worktree'
          : 'New sessions will be created in the current directory'
      writeStatus(
        `    ${chalk.dim(`Capacity: ${sessionActive}/${sessionMax} \u00b7 ${modeHint}`)}\n`,
      )
      for (const [, info] of sessionDisplayInfo) {
// 没有标题就显示已连接，避免空着
        const titleText = info.title
          ? truncatePrompt(info.title, 35)
          : chalk.dim('Attached')
// 标题包成可点击链接，点开就是网页端的该会话
        const titleLinked = wrapWithOsc8Link(titleText, info.url)
        const act = info.activity
// 结果与错误不显示在活动位：这两类已经由状态行表达过了
        const showAct = act && act.type !== 'result' && act.type !== 'error'
        const actText = showAct
          ? chalk.dim(` ${truncatePrompt(act.summary, 40)}`)
          : ''
        writeStatus(`    ${titleLinked}${actText}
`)
      }
    }

    // Mode line for spawn modes with a single slot (or true single-session mode)
// 只有一个槽位时也要显示模式，否则用户不知道新会话会开在哪里
    if (sessionMax === 1) {
      const modeText =
        spawnMode === 'single-session'
          ? 'Single session \u00b7 exits when complete'
          : spawnMode === 'worktree'
            ? `Capacity: ${sessionActive}/1 \u00b7 New sessions will be created in an isolated worktree`
            : `Capacity: ${sessionActive}/1 \u00b7 New sessions will be created in the current directory`
      writeStatus(`    ${chalk.dim(modeText)}\n`)
    }

    // Tool activity line for single-session mode
// 工具行三个条件：单会话、非就绪、最近一次工具活动还没过期
    if (
      sessionMax === 1 &&
      !isIdle &&
      lastToolSummary &&
      Date.now() - lastToolTime < TOOL_DISPLAY_EXPIRY_MS
    ) {
      writeStatus(`  ${chalk.dim(truncatePrompt(lastToolSummary, 60))}\n`)
    }

    // Blank line separator before footer
// 有会话地址就用会话地址，否则用环境地址——两者指向不同的网页端页面
    const url = activeSessionUrl ?? connectUrl
    if (url) {
      writeStatus('\n')
// 就绪与忙碌的页脚文案不同：一个引导去网页端，一个提示正在跑
      const footerText = isIdle
        ? buildIdleFooterText(url)
        : buildActiveFooterText(url)
      const qrHint = qrVisible
        ? chalk.dim.italic('space to hide QR code')
        : chalk.dim.italic('space to show QR code')
      const toggleHint = spawnModeDisplay
        ? chalk.dim.italic(' \u00b7 w to toggle spawn mode')
        : ''
      writeStatus(`${chalk.dim(footerText)}\n`)
      writeStatus(`${qrHint}${toggleHint}\n`)
    }
  }

  return {
// 打印横幅：缓存入口地址与环境标识，后面的会话链接都靠它们拼
    printBanner(config: BridgeConfig, environmentId: string): void {
      cachedIngressUrl = config.sessionIngressUrl
      cachedEnvironmentId = environmentId
      connectUrl = buildBridgeConnectUrl(environmentId, cachedIngressUrl)
      regenerateQr(connectUrl)

      if (verbose) {
// 版本号来自构建期注入的常量，运行时不存在这个对象
        write(chalk.dim(`Remote Control`) + ` v${MACRO.VERSION}\n`)
      }
      if (verbose) {
        if (config.spawnMode !== 'single-session') {
          write(chalk.dim(`Spawn mode: `) + `${config.spawnMode}\n`)
          write(
            chalk.dim(`Max concurrent sessions: `) + `${config.maxSessions}\n`,
          )
        }
        write(chalk.dim(`Environment ID: `) + `${environmentId}\n`)
      }
// 沙箱状态总是显示，因为它影响命令能做什么
      if (config.sandbox) {
        write(chalk.dim(`Sandbox: `) + `${chalk.green('Enabled')}\n`)
      }
      write('\n')

      // Start connecting spinner — first updateIdleStatus() will stop it
// 横幅末尾启动转圈，第一次就绪状态会把它停掉
      startConnecting()
    },

// 会话开始的日志只在详细模式下打，正常模式由状态区承担
    logSessionStart(sessionId: string, prompt: string): void {
      if (verbose) {
        const short = truncatePrompt(prompt, 80)
        printLog(
          chalk.dim(`[${timestamp()}]`) +
            ` Session started: ${chalk.white(`"${short}"`)} (${chalk.dim(sessionId)})\n`,
        )
      }
    },

    logSessionComplete(sessionId: string, durationMs: number): void {
      printLog(
        chalk.dim(`[${timestamp()}]`) +
          ` Session ${chalk.green('completed')} (${formatDuration(durationMs)}) ${chalk.dim(sessionId)}\n`,
      )
    },

    logSessionFailed(sessionId: string, error: string): void {
      printLog(
        chalk.dim(`[${timestamp()}]`) +
          ` Session ${chalk.red('failed')}: ${error} ${chalk.dim(sessionId)}\n`,
      )
    },

// 普通日志行：擦状态、写一行，下一次刷新再重画
    logStatus(message: string): void {
      printLog(chalk.dim(`[${timestamp()}]`) + ` ${message}\n`)
    },

    logVerbose(message: string): void {
      if (verbose) {
        printLog(chalk.dim(`[${timestamp()}] ${message}`) + '\n')
      }
    },

    logError(message: string): void {
      printLog(chalk.red(`[${timestamp()}] Error: ${message}`) + '\n')
    },

    logReconnected(disconnectedMs: number): void {
      printLog(
        chalk.dim(`[${timestamp()}]`) +
          ` ${chalk.green('Reconnected')} after ${formatDuration(disconnectedMs)}\n`,
      )
    },

    setRepoInfo(repo: string, branchName: string): void {
      repoName = repo
      branch = branchName
    },

    setDebugLogPath(path: string): void {
      debugLogPath = path
    },

// 回到就绪：停转圈、清工具行、清会话地址，二维码换回环境地址
    updateIdleStatus(): void {
      stopConnecting()

      currentState = 'idle'
      currentStateText = 'Ready'
      lastToolSummary = null
      lastToolTime = 0
      activeSessionUrl = null
      regenerateQr(connectUrl)
      renderStatusLine()
    },

// 已连接：单会话时把二维码换成会话地址，多会话时保持环境地址
    setAttached(sessionId: string): void {
      stopConnecting()
      currentState = 'attached'
      currentStateText = 'Connected'
      lastToolSummary = null
      lastToolTime = 0
      // Multi-session: keep footer/QR on the environment connect URL so users
      // can spawn more sessions. Per-session links are in the bullet list.
// 多会话场景下页脚要留给环境地址，用户才能继续开新会话；会话链接在下面的清单里
      if (sessionMax <= 1) {
        activeSessionUrl = buildBridgeSessionUrl(
          sessionId,
          cachedEnvironmentId,
          cachedIngressUrl,
        )
        regenerateQr(activeSessionUrl)
      }
      renderStatusLine()
    },

// 重连状态自己绘制：擦掉状态区，画二维码，再画一行带帧、延迟与断开时长的提示
    updateReconnectingStatus(delayStr: string, elapsedStr: string): void {
      stopConnecting()
      clearStatusLines()
      currentState = 'reconnecting'

      // QR code above the status line
      if (qrVisible) {
        for (const line of qrLines) {
          writeStatus(`${chalk.dim(line)}\n`)
        }
      }

      const frame =
        BRIDGE_SPINNER_FRAMES[connectingTick % BRIDGE_SPINNER_FRAMES.length]!
// 这里的帧计数是复用的：连接中与重连中不并存，共用一个计数器不会冲突
      connectingTick++
      writeStatus(
        `${chalk.yellow(frame)} ${chalk.yellow('Reconnecting')} ${chalk.dim('\u00b7')} ${chalk.dim(`retrying in ${delayStr}`)} ${chalk.dim('\u00b7')} ${chalk.dim(`disconnected ${elapsedStr}`)}\n`,
      )
    },

// 失败状态：红色图标加一句固定页脚，错误详情单独一行
    updateFailedStatus(error: string): void {
      stopConnecting()
      clearStatusLines()
      currentState = 'failed'

      let suffix = ''
      if (repoName) {
        suffix += chalk.dim(' \u00b7 ') + chalk.dim(repoName)
      }
      if (branch) {
        suffix += chalk.dim(' \u00b7 ') + chalk.dim(branch)
      }

      writeStatus(
        `${chalk.red(BRIDGE_FAILED_INDICATOR)} ${chalk.red('Remote Control Failed')}${suffix}\n`,
      )
      writeStatus(`${chalk.dim(FAILED_FOOTER_TEXT)}\n`)

      if (error) {
        writeStatus(`${chalk.red(error)}\n`)
      }
    },

// 活动更新只缓存工具活动并触发重画，其余参数接收但不用，所以形参都带了下划线前缀
    updateSessionStatus(
      _sessionId: string,
      _elapsed: string,
      activity: SessionActivity,
      _trail: string[],
    ): void {
      // Cache tool activity for the second status line
      if (activity.type === 'tool_start') {
        lastToolSummary = activity.summary
        lastToolTime = Date.now()
      }
      renderStatusLine()
    },

// 清屏要连转圈一起停，否则下一次定时器回调又把它画回来
    clearStatus(): void {
      stopConnecting()
      clearStatusLines()
    },

// 切换二维码只是翻一个布尔再重画
    toggleQr(): void {
      qrVisible = !qrVisible
      renderStatusLine()
    },

// 计数没变就早退：这个方法被高频调用，避免无谓重画
    updateSessionCount(active: number, max: number, mode: SpawnMode): void {
      if (sessionActive === active && sessionMax === max && spawnMode === mode)
        return
      sessionActive = active
      sessionMax = max
      spawnMode = mode
// 刻意不在这里重画：刷新由状态定时器按自己的节奏做，下一拍自然带上新值
      // Don't re-render here — the status ticker calls renderStatusLine
      // on its own cadence, and the next tick will pick up the new values.
    },

// 模式展示同步写回主状态，让下一次渲染的模式提示与分支可见性正确
    setSpawnModeDisplay(mode: 'same-dir' | 'worktree' | null): void {
      if (spawnModeDisplay === mode) return
      spawnModeDisplay = mode
      // Also sync the #21118-added spawnMode so the next render shows correct
      // mode hint + branch visibility. Don't render here — matches
      // updateSessionCount: called before printBanner (initial setup) and
      // again from the `w` handler (which follows with refreshDisplay).
      if (mode) spawnMode = mode
    },

// 新会话入列时只登记地址，标题与活动等后续事件补
    addSession(sessionId: string, url: string): void {
      sessionDisplayInfo.set(sessionId, { url })
    },

    updateSessionActivity(sessionId: string, activity: SessionActivity): void {
      const info = sessionDisplayInfo.get(sessionId)
      if (!info) return
      info.activity = activity
    },

// 拿到标题后单会话还要把它转成主状态文案，多会话只更新清单
    setSessionTitle(sessionId: string, title: string): void {
      const info = sessionDisplayInfo.get(sessionId)
      if (!info) return
      info.title = title
      // Guard against reconnecting/failed — renderStatusLine clears then returns
      // early for those states, which would erase the spinner/error.
// 重连与失败状态下直接返回：主渲染对这两种状态是先擦后返回，会把转圈或错误抹掉
      if (currentState === 'reconnecting' || currentState === 'failed') return
      if (sessionMax === 1) {
        // Single-session: show title in the main status line too.
        currentState = 'titled'
        currentStateText = truncatePrompt(title, 40)
      }
      renderStatusLine()
    },

// 移除只删登记表，状态区下次刷新自然少一行
    removeSession(sessionId: string): void {
      sessionDisplayInfo.delete(sessionId)
    },

// 外部触发的强制刷新，同样要避开那两种自绘状态
    refreshDisplay(): void {
      // Skip during reconnecting/failed — renderStatusLine clears then returns
      // early for those states, which would erase the spinner/error.
      if (currentState === 'reconnecting' || currentState === 'failed') return
      renderStatusLine()
    },
  }
}
