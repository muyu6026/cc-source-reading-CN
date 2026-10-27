/**
 * TMUX SOCKET ISOLATION
 * =====================
 * This module manages an isolated tmux socket for Claude's operations.
 *
 * WHY THIS EXISTS:
 * Without isolation, Claude could accidentally affect the user's tmux sessions.
 * For example, running `tmux kill-session` via the Bash tool would kill the
 * user's current session if they started Claude from within tmux.
 *
 * HOW IT WORKS:
 * 1. Claude creates its own tmux socket: `claude-<PID>` (e.g., `claude-12345`)
 * 2. ALL Tmux tool commands use this socket via the `-L` flag
 * 3. ALL Bash tool commands inherit TMUX env var pointing to this socket
 *    (set in Shell.ts via getClaudeTmuxEnv())
 *
 * This means ANY tmux command run through Claude - whether via the Tmux tool
 * directly or via Bash - will operate on Claude's isolated socket, NOT the
 * user's tmux session.
 *
 * IMPORTANT: The user's original TMUX env var is NOT used. After socket
 * initialization, getClaudeTmuxEnv() returns a value that overrides the
 * user's TMUX in all child processes spawned by Shell.ts.
 */
// 文件级：本文件管理 Claude 专用的隔离 tmux socket，避免误伤用户自己的 tmux 会话。所有 Tmux 工具与 Bash 命令都走 `claude-<PID>` 这个独立 socket，子进程继承的 `TMUX` 环境变量也被覆盖成 Claude 的 socket，从而保证任何 tmux 命令都作用于隔离环境而非用户会话。

import { posix } from 'path'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { toError } from './errors.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { logError } from './log.js'
import { getPlatform } from './platform.js'

// Constants for tmux socket management
const TMUX_COMMAND = 'tmux'
// `TMUX_COMMAND`：要执行的 tmux 命令名，固定为 `tmux`。
const CLAUDE_SOCKET_PREFIX = 'claude'
// `CLAUDE_SOCKET_PREFIX`：socket 名前缀，拼上进程 PID 形成唯一 socket 名。

/**
 * Executes a tmux command, routing through WSL on Windows.
 * On Windows, tmux only exists inside WSL — WSL interop lets the tmux session
 * launch .exe files as native Win32 processes while stdin/stdout flow through
 * the WSL pty.
 */
// `execTmux`：执行一条 tmux 命令；Windows 上 tmux 只存在于 WSL 内，于是走 `wsl -e tmux` 并把输出归一化成 `{stdout, stderr, code}`。
async function execTmux(
  args: string[],
  opts?: { useCwd?: boolean },
): Promise<{ stdout: string; stderr: string; code: number }> {
  if (getPlatform() === 'windows') {
// Windows 分支：用 `wsl -e` 直接执行 tmux（避开登录 shell 把 `#` 当注释吃掉的问题），并设置 `WSL_UTF8` 编码。
    // -e execs tmux directly without the login shell. Without it, wsl hands the
    // command line to bash which eats `#` as a comment: `display-message -p
    // #{socket_path},#{pid}` below becomes `display-message -p ` → exit 1 →
    // we silently fall back to the guessed path and never learn the real
    // server PID. Same root cause as TungstenTool/utils.ts:execTmuxCommand.
    const result = await execFileNoThrow('wsl', ['-e', TMUX_COMMAND, ...args], {
      env: { ...process.env, WSL_UTF8: '1' },
      ...opts,
    })
    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      code: result.code || 0,
    }
  }
  const result = await execFileNoThrow(TMUX_COMMAND, args, opts)
// 非 Windows 直接用 `execFileNoThrow` 跑 tmux 命令。
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    code: result.code || 0,
  }
}

// Socket state - initialized lazily when Tmux tool is first used or a tmux command is run
let socketName: string | null = null
// socket 状态变量，惰性初始化：socket 名、路径、服务器 PID、初始化标志与初始化承诺。
let socketPath: string | null = null
let serverPid: number | null = null
let isInitializing = false
let initPromise: Promise<void> | null = null

// tmux availability - checked once upfront
let tmuxAvailabilityChecked = false
// tmux 可用性只在前端检查一次并缓存到进程生命周期。
let tmuxAvailable = false

// Track whether the Tmux tool has been used at least once
// Used to defer socket initialization until actually needed
let tmuxToolUsed = false
// `tmuxToolUsed`：标记 Tmux 工具是否被用过，用于把 socket 初始化推迟到真正需要时才做。

/**
 * Gets the socket name for Claude's isolated tmux session.
 * Format: claude-<PID>
 */
// `getClaudeSocketName`：返回隔离 socket 名，格式 `claude-<PID>`，首次调用时惰性生成。
export function getClaudeSocketName(): string {
  if (!socketName) {
    socketName = `${CLAUDE_SOCKET_PREFIX}-${process.pid}`
  }
  return socketName
}

/**
 * Gets the socket path if the socket has been initialized.
 * Returns null if not yet initialized.
 */
// `getClaudeSocketPath`：返回已初始化的 socket 路径，未初始化则返回 `null`。
export function getClaudeSocketPath(): string | null {
  return socketPath
}

/**
 * Sets socket info after initialization.
 * Called after the tmux session is created.
 */
// `setClaudeSocketInfo`：初始化后写入 socket 路径与服务器 PID。
export function setClaudeSocketInfo(path: string, pid: number): void {
  socketPath = path
  serverPid = pid
}

/**
 * Returns whether the socket has been initialized.
 */
// `isSocketInitialized`：socket 路径与服务器 PID 都非空才算初始化完成。
export function isSocketInitialized(): boolean {
  return socketPath !== null && serverPid !== null
}

/**
 * Gets the TMUX environment variable value for Claude's isolated socket.
 *
 * CRITICAL: This value is used by Shell.ts to override the TMUX env var
 * in ALL child processes. This ensures that any `tmux` command run via
 * the Bash tool will operate on Claude's socket, NOT the user's session.
 *
 * Format: "socket_path,server_pid,pane_index" (matches tmux's TMUX env var)
 * Example: "/tmp/tmux-501/claude-12345,54321,0"
 *
 * Returns null if socket is not yet initialized.
 * When null, Shell.ts does not override TMUX, preserving user's environment.
 */
// `getClaudeTmuxEnv`：返回给 Shell.ts 覆盖 `TMUX` 环境变量的字符串，格式 `socket路径,服务器PID,面板索引`，未初始化返回 `null`（此时不覆盖、保留用户环境）。
export function getClaudeTmuxEnv(): string | null {
  if (!socketPath || serverPid === null) {
    return null
  }
  return `${socketPath},${serverPid},0`
// 拼出 `socket路径,serverPid,0` 这种与 tmux 自身 `TMUX` 变量一致的三段格式。
}

/**
 * Checks if tmux is available on this system.
 * This is checked once and cached for the lifetime of the process.
 *
 * When tmux is not available:
 * - TungstenTool (Tmux) will not work
 * - TeammateTool will not work (it uses tmux for pane management)
 * - Bash commands will run without tmux isolation
 */
// `checkTmuxAvailable`：检查系统是否装了 tmux，只查一次并缓存；Windows 走 `wsl -e tmux -V`，否则用 `which tmux`。
export async function checkTmuxAvailable(): Promise<boolean> {
  if (!tmuxAvailabilityChecked) {
    const result =
      getPlatform() === 'windows'
        ? await execFileNoThrow('wsl', ['-e', TMUX_COMMAND, '-V'], {
            env: { ...process.env, WSL_UTF8: '1' },
            useCwd: false,
          })
        : await execFileNoThrow('which', [TMUX_COMMAND], {
            useCwd: false,
          })
    tmuxAvailable = result.code === 0
// 退出码为 0 表示可用，否则记调试日志提示 Tmux 与 Teammate 工具将不可用。
    if (!tmuxAvailable) {
      logForDebugging(
        `[Socket] tmux is not installed. The Tmux tool and Teammate tool will not be available.`,
      )
    }
    tmuxAvailabilityChecked = true
// 标记可用性已检查，后续直接走缓存。
  }
  return tmuxAvailable
}

/**
 * Returns the cached tmux availability status.
 * Returns false if availability hasn't been checked yet.
 * Use checkTmuxAvailable() to perform the check.
 */
// `isTmuxAvailable`：返回缓存的 tmux 可用性，未检查过时返回 `false`。
export function isTmuxAvailable(): boolean {
  return tmuxAvailabilityChecked && tmuxAvailable
}

/**
 * Marks that the Tmux tool has been used at least once.
 * Called by TungstenTool before initialization.
 * After this is called, Shell.ts will initialize the socket for subsequent Bash commands.
 */
// `markTmuxToolUsed`：Tmux 工具被使用时调用，触发后续 Bash 命令的 socket 初始化。
export function markTmuxToolUsed(): void {
  tmuxToolUsed = true
}

/**
 * Returns whether the Tmux tool has been used at least once.
 * Used by Shell.ts to decide whether to initialize the socket.
 */
// `hasTmuxToolBeenUsed`：供 Shell.ts 判断是否该初始化 socket。
export function hasTmuxToolBeenUsed(): boolean {
  return tmuxToolUsed
}

/**
 * Ensures the socket is initialized with a tmux session.
 * Called by Shell.ts when the Tmux tool has been used or the command includes "tmux".
 * Safe to call multiple times; will only initialize once.
 *
 * If tmux is not installed, this function returns gracefully without
 * initializing the socket. getClaudeTmuxEnv() will return null, and
 * Bash commands will run without tmux isolation.
 */
// `ensureSocketInitialized`：确保 socket 已被 tmux 会话初始化，可安全多次调用（只初始化一次）；未装 tmux 就优雅跳过，不抛错。
export async function ensureSocketInitialized(): Promise<void> {
  // Already initialized
  if (isSocketInitialized()) {
// 已初始化直接返回，不再重复。
    return
  }

  // Check if tmux is available before trying to use it
  const available = await checkTmuxAvailable()
// 先确认 tmux 可用，不可用就返回让 Bash 命令不带隔离运行。
  if (!available) {
    return
  }

  // Another call is already initializing - wait for it but don't propagate errors
  // The original caller handles the error and sets up graceful degradation
  if (isInitializing && initPromise) {
// 已有别的调用在初始化时，等它的承诺完成即可，错误由最初调用方记录。
    try {
      await initPromise
    } catch {
      // Ignore - the original caller logs the error
    }
    return
  }

  isInitializing = true
// 置初始化标志并启动真正的初始化过程 `doInitialize`。
  initPromise = doInitialize()

  try {
    await initPromise
  } catch (error) {
    // Log error but don't throw - graceful degradation
    const err = toError(error)
    logError(err)
// 初始化失败只记日志不抛出，降级为不隔离，避免拖垮整个进程。
    logForDebugging(
      `[Socket] Failed to initialize tmux socket: ${err.message}. Tmux isolation will be disabled.`,
    )
  } finally {
    isInitializing = false
  }
}

/**
 * Kills the tmux server for Claude's isolated socket.
 * Called during graceful shutdown to clean up resources.
 */
// `killTmuxServer`：优雅退出时杀掉 Claude 隔离 socket 上的 tmux 服务器，清理资源。
async function killTmuxServer(): Promise<void> {
  const socket = getClaudeSocketName()
  logForDebugging(`[Socket] Killing tmux server for socket: ${socket}`)

  const result = await execTmux(['-L', socket, 'kill-server'])

  if (result.code === 0) {
    logForDebugging(`[Socket] Successfully killed tmux server`)
  } else {
    // Server may already be dead, which is fine
    logForDebugging(
      `[Socket] Failed to kill tmux server (exit ${result.code}): ${result.stderr}`,
    )
  }
}

// `doInitialize`：真正创建 tmux 会话并采集 socket 路径与服务器 PID；含 Windows 上把 `WSL_INTEROP` 固定到稳定符号链接以保互操作的特殊处理。
async function doInitialize(): Promise<void> {
  const socket = getClaudeSocketName()

  // Create a new session with our custom socket
  // Pass CLAUDE_CODE_SKIP_PROMPT_HISTORY via -e so it's set in the initial shell environment
  //
  // On Windows, the tmux server inherits WSL_INTEROP from the short-lived
  // wsl.exe that spawns it; once `new-session -d` detaches and wsl.exe exits,
  // that socket stops servicing requests. Any cli.exe launched inside the pane
  // then hits `UtilAcceptVsock: accept4 failed 110` (ETIMEDOUT). Observed on
  // 2026-03-25: server PID 386 (started alongside /init at WSL boot) inherited
  // /run/WSL/383_interop — init's own socket, which listens but doesn't handle
  // interop. /run/WSL/1_interop is a stable symlink WSL maintains to the real
  // handler; pin the server to it so interop survives the spawning wsl.exe.
  const result = await execTmux([
    '-L',
    socket,
    'new-session',
    '-d',
    '-s',
    'base',
    '-e',
    'CLAUDE_CODE_SKIP_PROMPT_HISTORY=true',
    ...(getPlatform() === 'windows'
      ? ['-e', 'WSL_INTEROP=/run/WSL/1_interop']
      : []),
  ])
// 用 `-L` 指定隔离 socket 创建名为 `base` 的后台会话，并设 `CLAUDE_CODE_SKIP_PROMPT_HISTORY` 避免污染用户历史。

  if (result.code !== 0) {
// 若建会话失败，再 `has-session` 确认是否其实已存在，确实没有才抛错。
    // Session might already exist from a previous run with same PID (unlikely but possible)
    // Check if the session exists
    const checkResult = await execTmux([
      '-L',
      socket,
      'has-session',
      '-t',
      'base',
    ])
    if (checkResult.code !== 0) {
      throw new Error(
        `Failed to create tmux session on socket ${socket}: ${result.stderr}`,
      )
    }
  }

  // Register cleanup to kill the tmux server on exit
  registerCleanup(killTmuxServer)
// 注册退出清理，进程结束时杀掉 tmux 服务器。

  // Set CLAUDE_CODE_SKIP_PROMPT_HISTORY in the tmux GLOBAL environment (-g).
  // Without -g this would only apply to the 'base' session, and new sessions
  // created by TungstenTool (e.g. 'test', 'verify') would not inherit it.
  // Any Claude Code instance spawned on this socket will inherit this env var,
  // preventing test/verification sessions from polluting the user's real
  // command history and --resume session list.
  await execTmux([
    '-L',
    socket,
    'set-environment',
    '-g',
    'CLAUDE_CODE_SKIP_PROMPT_HISTORY',
    'true',
  ])
// 用 `-g` 把跳过提示历史设进全局环境，让 Tmux 工具新建的会话也继承，避免测试会话污染用户的真实历史与恢复列表。

  // Same WSL_INTEROP pin as the new-session -e above, but in the GLOBAL env
  // so sessions created by TungstenTool inherit it too. The -e on new-session
  // only covers the base session's initial shell; a later `new-session -s cc`
  // inherits the SERVER's env, which still holds the stale socket from the
  // wsl.exe that spawned it.
  if (getPlatform() === 'windows') {
// Windows 上同样把 `WSL_INTEROP` 钉进全局环境，让后续新建会话继承稳定的互操作 socket。
    await execTmux([
      '-L',
      socket,
      'set-environment',
      '-g',
      'WSL_INTEROP',
      '/run/WSL/1_interop',
    ])
  }

  // Get the socket path and server PID
  const infoResult = await execTmux([
    '-L',
    socket,
    'display-message',
    '-p',
    '#{socket_path},#{pid}',
  ])
// 用 `display-message -p` 取 `socket_path,pid`，解析出路径与服务器 PID 后写入状态。

  if (infoResult.code === 0) {
    const [path, pidStr] = infoResult.stdout.trim().split(',')
    if (path && pidStr) {
      const pid = parseInt(pidStr, 10)
      if (!isNaN(pid)) {
        setClaudeSocketInfo(path, pid)
        return
      }
    }
    // Parsing failed - log and fall through to fallback
    logForDebugging(
      `[Socket] Failed to parse socket info from tmux output: "${infoResult.stdout.trim()}". Using fallback path.`,
    )
  } else {
    // Command failed - log and fall through to fallback
    logForDebugging(
      `[Socket] Failed to get socket info via display-message (exit ${infoResult.code}): ${infoResult.stderr}. Using fallback path.`,
    )
  }

  // Fallback: construct the socket path from standard tmux location
  // tmux sockets are typically at $TMPDIR/tmux-<UID>/<socket_name> (or /tmp/tmux-<UID>/ if TMPDIR is not set)
  // On Windows this path is inside WSL, so always use POSIX separators.
  // process.getuid() is undefined on Windows; WSL default user is root (uid 0) in CI.
// 主路径解析失败时的兜底：按标准 tmux 位置 `$TMPDIR/tmux-<UID>/<socket名>` 拼出路径（Windows 在 WSL 内，用 POSIX 分隔符）。
  const uid = process.getuid?.() ?? 0
// `uid` 取 `process.getuid`（Windows 未定义则按 0），`TMPDIR` 缺省回退 `/tmp`。
  const baseTmpDir = process.env.TMPDIR || '/tmp'
  const fallbackPath = posix.join(baseTmpDir, `tmux-${uid}`, socket)

  // Get server PID separately
  const pidResult = await execTmux([
    '-L',
    socket,
    'display-message',
    '-p',
    '#{pid}',
  ])
// 兜底单独取服务器 PID，写入失败路径与 PID 后返回。

  if (pidResult.code === 0) {
    const pid = parseInt(pidResult.stdout.trim(), 10)
    if (!isNaN(pid)) {
      logForDebugging(
        `[Socket] Using fallback socket path: ${fallbackPath} (server PID: ${pid})`,
      )
      setClaudeSocketInfo(fallbackPath, pid)
      return
    }
    // PID parsing failed
    logForDebugging(
      `[Socket] Failed to parse server PID from tmux output: "${pidResult.stdout.trim()}"`,
    )
  } else {
    logForDebugging(
      `[Socket] Failed to get server PID (exit ${pidResult.code}): ${pidResult.stderr}`,
    )
  }

  throw new Error(
    `Failed to get socket info for ${socket}: primary="${infoResult.stderr}", fallback="${pidResult.stderr}"`,
  )
// 主路径与兜底都失败才抛出错误，附带两份 stderr 便于排查。
}

// For testing purposes
// `resetSocketState`：测试辅助，把所有 socket 状态变量归零。
export function resetSocketState(): void {
  socketName = null
  socketPath = null
  serverPid = null
  isInitializing = false
  initPromise = null
  tmuxAvailabilityChecked = false
  tmuxAvailable = false
  tmuxToolUsed = false
}
