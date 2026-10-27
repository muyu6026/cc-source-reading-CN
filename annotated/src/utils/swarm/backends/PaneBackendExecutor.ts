import { getSessionId } from '../../../bootstrap/state.js'
import type { ToolUseContext } from '../../../Tool.js'
import { formatAgentId, parseAgentId } from '../../../utils/agentId.js'
import { quote } from '../../../utils/bash/shellQuote.js'
import { registerCleanup } from '../../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../../utils/debug.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import { writeToMailbox } from '../../../utils/teammateMailbox.js'
import {
  buildInheritedCliFlags,
  buildInheritedEnvVars,
  getTeammateCommand,
} from '../spawnUtils.js'
import { assignTeammateColor } from '../teammateLayoutManager.js'
import { isInsideTmux } from './detection.js'
import type {
  BackendType,
  PaneBackend,
  TeammateExecutor,
  TeammateMessage,
  TeammateSpawnConfig,
  TeammateSpawnResult,
} from './types.js'

/**
 * PaneBackendExecutor adapts a PaneBackend to the TeammateExecutor interface.
 *
 * This allows pane-based backends (tmux, iTerm2) to be used through the same
 * TeammateExecutor abstraction as InProcessBackend, making getTeammateExecutor()
 * return a meaningful executor regardless of execution mode.
 *
 * The adapter handles:
 * - spawn(): Creates a pane and sends the Claude CLI command to it
 * - sendMessage(): Writes to the teammate's file-based mailbox
 * - terminate(): Sends a shutdown request via mailbox
 * - kill(): Kills the pane via the backend
 * - isActive(): Checks if the pane is still running
 */
export class PaneBackendExecutor implements TeammateExecutor {
// `PaneBackendExecutor` 把 `PaneBackend` 适配为 `TeammateExecutor` 接口，使分屏后端与进程内后端走同一抽象。
  readonly type: BackendType

  private backend: PaneBackend
  private context: ToolUseContext | null = null

  /**
   * Track spawned teammates by agentId -> paneId mapping.
   * This allows us to find the pane for operations like kill/terminate.
   */
  private spawnedTeammates: Map<string, { paneId: string; insideTmux: boolean }>
// 用 `agentId` 到分屏信息的映射追踪已生成的队友。
  private cleanupRegistered = false

  constructor(backend: PaneBackend) {
    this.backend = backend
    this.type = backend.type
    this.spawnedTeammates = new Map()
  }
// 构造函数保存后端引用并初始化追踪表。

  /**
   * Sets the ToolUseContext for this executor.
   * Must be called before spawn() to provide access to AppState and permissions.
   */
  setContext(context: ToolUseContext): void {
// `setContext` 注入工具调用上下文，spawn 前必须调用。
    this.context = context
  }

  /**
   * Checks if the underlying pane backend is available.
   */
  async isAvailable(): Promise<boolean> {
    return this.backend.isAvailable()
  }
// `isAvailable` 委托底层后端判断是否可用。

  /**
   * Spawns a teammate in a new pane.
   *
   * Creates a pane via the backend, builds the CLI command with teammate
   * identity flags, and sends it to the pane.
   */
  async spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult> {
// `spawn` 创建分屏并发送带队友身份标识的 Claude CLI 命令。
    const agentId = formatAgentId(config.name, config.teamName)

    if (!this.context) {
      logForDebugging(
        `[PaneBackendExecutor] spawn() called without context for ${config.name}`,
      )
      return {
        success: false,
        agentId,
        error:
          'PaneBackendExecutor not initialized. Call setContext() before spawn().',
      }
    }

    try {
      // Assign a unique color to this teammate
      const teammateColor = config.color ?? assignTeammateColor(agentId)
// 为队友分配唯一颜色（或取配置里的颜色）。

      // Create a pane in the swarm view
      const { paneId, isFirstTeammate } =
        await this.backend.createTeammatePaneInSwarmView(
          config.name,
          teammateColor,
        )

      // Check if we're inside tmux to determine how to send commands
      const insideTmux = await isInsideTmux()
// 判断是否处于 tmux 内，以决定命令发送与分屏管理的方式。

      // Enable pane border status on first teammate when inside tmux
      if (isFirstTeammate && insideTmux) {
        await this.backend.enablePaneBorderStatus()
      }

      // Build the command to spawn Claude Code with teammate identity
      const binaryPath = getTeammateCommand()
// 取得队友命令的二进制路径。

      // Build teammate identity CLI args
      const teammateArgs = [
        `--agent-id ${quote([agentId])}`,
        `--agent-name ${quote([config.name])}`,
        `--team-name ${quote([config.teamName])}`,
        `--agent-color ${quote([teammateColor])}`,
        `--parent-session-id ${quote([config.parentSessionId || getSessionId()])}`,
        config.planModeRequired ? '--plan-mode-required' : '',
      ]
        .filter(Boolean)
        .join(' ')

// 组装队友身份相关的命令行参数（agent-id、name、team、color、parent-session）。
      // Build CLI flags to propagate to teammate
      const appState = this.context.getAppState()
      let inheritedFlags = buildInheritedCliFlags({
        planModeRequired: config.planModeRequired,
        permissionMode: appState.toolPermissionContext.mode,
      })

      // If teammate has a custom model, add --model flag (or replace inherited one)
      if (config.model) {
        inheritedFlags = inheritedFlags
          .split(' ')
          .filter(
            (flag, i, arr) => flag !== '--model' && arr[i - 1] !== '--model',
          )
          .join(' ')
        inheritedFlags = inheritedFlags
          ? `${inheritedFlags} --model ${quote([config.model])}`
          : `--model ${quote([config.model])}`
      }

      const flagsStr = inheritedFlags ? ` ${inheritedFlags}` : ''
// 拼接要向下传递的 CLI 标志，继承父会话的计划模式与权限模式。
      const workingDir = config.cwd

      // Build environment variables to forward to teammate
      const envStr = buildInheritedEnvVars()

      const spawnCommand = `cd ${quote([workingDir])} && env ${envStr} ${quote([binaryPath])} ${teammateArgs}${flagsStr}`
// 拼出最终派生命令：切换工作目录、注入环境变量、启动队友进程。

      // Send the command to the new pane
      // Use swarm socket when running outside tmux (external swarm session)
      await this.backend.sendCommandToPane(paneId, spawnCommand, !insideTmux)
// 向新分屏发送启动命令；外部 swarm 用 socket，tmux 内直接发送。

      // Track the spawned teammate
      this.spawnedTeammates.set(agentId, { paneId, insideTmux })
// 记录已生成的队友，便于后续 kill / terminate 定位分屏。

      // Register cleanup to kill all panes on leader exit (e.g., SIGHUP)
      if (!this.cleanupRegistered) {
        this.cleanupRegistered = true
        registerCleanup(async () => {
          for (const [id, info] of this.spawnedTeammates) {
            logForDebugging(
              `[PaneBackendExecutor] Cleanup: killing pane for ${id}`,
            )
            await this.backend.killPane(info.paneId, !info.insideTmux)
          }
          this.spawnedTeammates.clear()
        })
      }
// 注册退出清理：领导进程退出时杀掉所有已生成分屏。

      // Send initial instructions to teammate via mailbox
      await writeToMailbox(
// 通过基于文件的邮箱向队友发送初始指令。
        config.name,
        {
          from: 'team-lead',
          text: config.prompt,
          timestamp: new Date().toISOString(),
        },
        config.teamName,
      )

      logForDebugging(
        `[PaneBackendExecutor] Spawned teammate ${agentId} in pane ${paneId}`,
      )

      return {
        success: true,
        agentId,
        paneId,
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      logForDebugging(
        `[PaneBackendExecutor] Failed to spawn ${agentId}: ${errorMessage}`,
      )
      return {
        success: false,
        agentId,
        error: errorMessage,
      }
    }
  }
// `spawn` 结束，返回成功或失败结果。

  /**
   * Sends a message to a pane-based teammate via file-based mailbox.
   *
   * All teammates (pane and in-process) use the same mailbox mechanism.
   */
  async sendMessage(agentId: string, message: TeammateMessage): Promise<void> {
// `sendMessage` 通过文件邮箱给指定队友发送消息。
    logForDebugging(
      `[PaneBackendExecutor] sendMessage() to ${agentId}: ${message.text.substring(0, 50)}...`,
    )

    const parsed = parseAgentId(agentId)
// 先解析并校验 `agentId` 格式（期望 `agentName@teamName`）。
    if (!parsed) {
      throw new Error(
        `Invalid agentId format: ${agentId}. Expected format: agentName@teamName`,
      )
    }

    const { agentName, teamName } = parsed

    await writeToMailbox(
      agentName,
      {
        text: message.text,
        from: message.from,
        color: message.color,
        timestamp: message.timestamp ?? new Date().toISOString(),
      },
      teamName,
    )

    logForDebugging(
      `[PaneBackendExecutor] sendMessage() completed for ${agentId}`,
    )
  }
// 发消息结束。

  /**
   * Gracefully terminates a pane-based teammate.
   *
   * For pane-based teammates, we send a shutdown request via mailbox and
   * let the teammate process handle exit gracefully.
   */
  async terminate(agentId: string, reason?: string): Promise<boolean> {
// `terminate` 通过邮箱发送关闭请求，让队友进程自行优雅退出。
    logForDebugging(
      `[PaneBackendExecutor] terminate() called for ${agentId}: ${reason}`,
    )

    const parsed = parseAgentId(agentId)
    if (!parsed) {
      logForDebugging(
        `[PaneBackendExecutor] terminate() failed: invalid agentId format`,
      )
      return false
    }

    const { agentName, teamName } = parsed

    // Send shutdown request via mailbox
    const shutdownRequest = {
      type: 'shutdown_request',
      requestId: `shutdown-${agentId}-${Date.now()}`,
      from: 'team-lead',
      reason,
    }

    await writeToMailbox(
      agentName,
      {
        from: 'team-lead',
        text: jsonStringify(shutdownRequest),
        timestamp: new Date().toISOString(),
      },
      teamName,
    )

    logForDebugging(
      `[PaneBackendExecutor] terminate() sent shutdown request to ${agentId}`,
    )

    return true
  }
// 优雅终止函数结束。

  /**
   * Force kills a pane-based teammate by killing its pane.
   */
  async kill(agentId: string): Promise<boolean> {
// `kill` 直接杀掉队友所在分屏。
    logForDebugging(`[PaneBackendExecutor] kill() called for ${agentId}`)

    const teammateInfo = this.spawnedTeammates.get(agentId)
    if (!teammateInfo) {
      logForDebugging(
        `[PaneBackendExecutor] kill() failed: teammate ${agentId} not found in spawned map`,
      )
      return false
    }

    const { paneId, insideTmux } = teammateInfo

    // Kill the pane via the backend
    // Use external session socket when we spawned outside tmux
    const killed = await this.backend.killPane(paneId, !insideTmux)
// 调用后端 `killPane` 杀分屏；外部 session 用 socket。

    if (killed) {
      this.spawnedTeammates.delete(agentId)
      logForDebugging(`[PaneBackendExecutor] kill() succeeded for ${agentId}`)
    } else {
      logForDebugging(`[PaneBackendExecutor] kill() failed for ${agentId}`)
    }

    return killed
  }
// `kill` 结束，成功后从追踪表移除该队友。

  /**
   * Checks if a pane-based teammate is still active.
   *
   * For pane-based teammates, we check if the pane still exists.
   * This is a best-effort check - the pane may exist but the process inside
   * may have exited.
   */
  async isActive(agentId: string): Promise<boolean> {
// `isActive` 检查队友是否仍被记录为活跃（尽力而为）。
    logForDebugging(`[PaneBackendExecutor] isActive() called for ${agentId}`)

    const teammateInfo = this.spawnedTeammates.get(agentId)
    if (!teammateInfo) {
      logForDebugging(
        `[PaneBackendExecutor] isActive(): teammate ${agentId} not found`,
      )
      return false
    }

    // For now, assume active if we have a record of it
    // A more robust check would query the backend for pane existence
    // but that would require adding a new method to PaneBackend
    return true
  }
// 活跃检查结束，仅依据是否仍有记录判断。
}
// 类定义结束。

/**
 * Creates a PaneBackendExecutor wrapping the given PaneBackend.
 */
export function createPaneBackendExecutor(
  backend: PaneBackend,
): PaneBackendExecutor {
  return new PaneBackendExecutor(backend)
}
// `createPaneBackendExecutor` 工厂函数，包装给定后端返回执行器。
