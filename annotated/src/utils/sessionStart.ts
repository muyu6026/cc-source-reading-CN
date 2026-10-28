import { getMainThreadAgentType } from '../bootstrap/state.js'
import type { HookResultMessage } from '../types/message.js'
import { createAttachmentMessage } from './attachments.js'
import { logForDebugging } from './debug.js'
import { withDiagnosticsTiming } from './diagLogs.js'
import { isBareMode } from './envUtils.js'
import { updateWatchPaths } from './hooks/fileChangedWatcher.js'
import { shouldAllowManagedHooksOnly } from './hooks/hooksConfigSnapshot.js'
import { executeSessionStartHooks, executeSetupHooks } from './hooks.js'
import { logError } from './log.js'
import { loadPluginHooks } from './plugins/loadPluginHooks.js'

type SessionStartHooksOptions = {
  sessionId?: string
  agentType?: string
  model?: string
  forceSyncExecution?: boolean
}
// 会话启动钩子的选项：sessionId、agentType、model 可覆盖，forceSyncExecution 强制同步执行。

// Set by processSessionStartHooks when a hook emits initialUserMessage;
// consumed once by takeInitialUserMessage. This side channel avoids changing
// the Promise<HookResultMessage[]> return type that main.tsx and print.ts
// both already await on (sessionStartHooksPromise is kicked in main.tsx and
// joined later — rippling a structural return-type change through that
// handoff would touch five callsites for what is a print-mode-only value).
let pendingInitialUserMessage: string | undefined
// 旁路通道：存放某个钩子吐出的「初始用户消息」，只被 takeInitialUserMessage 取一次。这样设计是为了不改动主流程 Promise<HookResultMessage[]> 的返回类型。

export function takeInitialUserMessage(): string | undefined {
  const v = pendingInitialUserMessage
  pendingInitialUserMessage = undefined
  return v
}
// 取出并清空 pendingInitialUserMessage —— 一次性消费，避免被重复读取。

// Note to CLAUDE: do not add ANY "warmup" logic. It is **CRITICAL** that you do not add extra work on startup.
export async function processSessionStartHooks(
  source: 'startup' | 'resume' | 'clear' | 'compact',
  {
    sessionId,
    agentType,
    model,
    forceSyncExecution,
  }: SessionStartHooksOptions = {},
): Promise<HookResultMessage[]> {
// 会话启动钩子主入口：source 区分启动、恢复、清空、压缩四种触发场景，并带可选覆盖项。
  // --bare skips all hooks. executeHooks already early-returns under --bare
  // (hooks.ts:1861), but this skips the loadPluginHooks() await below too —
  // no point loading plugin hooks that'll never run.
  if (isBareMode()) {
    return []
  }
// bare 模式直接跳过所有钩子（连插件钩子的加载都不做），因为 bare 下钩子本就不会运行。
  const hookMessages: HookResultMessage[] = []
  const additionalContexts: string[] = []
  const allWatchPaths: string[] = []

  // Skip loading plugin hooks if restricted to managed hooks only
  // Plugin hooks are untrusted external code that should be blocked by policy
  if (shouldAllowManagedHooksOnly()) {
    logForDebugging('Skipping plugin hooks - allowManagedHooksOnly is enabled')
  } else {
    // Ensure plugin hooks are loaded before executing SessionStart hooks.
    // loadPluginHooks() may be called early during startup (fire-and-forget, non-blocking)
    // to pre-load hooks, but we must guarantee hooks are registered before executing them.
    // This function is memoized, so if hooks are already loaded, this returns immediately
    // with negligible overhead (just a cache lookup).
    try {
      await withDiagnosticsTiming('load_plugin_hooks', () => loadPluginHooks())
    } catch (error) {
      // Log error but don't crash - continue with session start without plugin hooks
      /* eslint-disable no-restricted-syntax -- both branches wrap with context, not a toError case */
      const enhancedError =
        error instanceof Error
          ? new Error(
              `Failed to load plugin hooks during ${source}: ${error.message}`,
            )
          : new Error(
              `Failed to load plugin hooks during ${source}: ${String(error)}`,
            )
      /* eslint-enable no-restricted-syntax */

      if (error instanceof Error && error.stack) {
        enhancedError.stack = error.stack
      }

      logError(enhancedError)

      // Provide specific guidance based on error type
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      let userGuidance = ''

      if (
        errorMessage.includes('Failed to clone') ||
        errorMessage.includes('network') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('ENOTFOUND')
      ) {
        userGuidance =
          'This appears to be a network issue. Check your internet connection and try again.'
      } else if (
        errorMessage.includes('Permission denied') ||
        errorMessage.includes('EACCES') ||
        errorMessage.includes('EPERM')
      ) {
        userGuidance =
          'This appears to be a permissions issue. Check file permissions on ~/.claude/plugins/'
      } else if (
        errorMessage.includes('Invalid') ||
        errorMessage.includes('parse') ||
        errorMessage.includes('JSON') ||
        errorMessage.includes('schema')
      ) {
        userGuidance =
          'This appears to be a configuration issue. Check your plugin settings in .claude/settings.json'
      } else {
        userGuidance =
          'Please fix the plugin configuration or remove problematic plugins from your settings.'
      }

      logForDebugging(
        `Warning: Failed to load plugin hooks. SessionStart hooks from plugins will not execute. ` +
          `Error: ${errorMessage}. ${userGuidance}`,
        { level: 'warn' },
      )

      // Continue execution - plugin hooks won't be available, but project-level hooks
      // from .claude/settings.json (loaded via captureHooksConfigSnapshot) will still work
    }
  }
// 加载插件钩子失败时按错误类型给出「网络、权限、配置」等针对性提示，但不中断会话启动；仅项目级钩子仍可用。

  // Execute SessionStart hooks, ignoring blocking errors
  // Use the provided agentType or fall back to the one stored in bootstrap state
  const resolvedAgentType = agentType ?? getMainThreadAgentType()
  for await (const hookResult of executeSessionStartHooks(
    source,
    sessionId,
    resolvedAgentType,
    model,
    undefined,
    undefined,
    forceSyncExecution,
  )) {
    if (hookResult.message) {
      hookMessages.push(hookResult.message)
    }
    if (
      hookResult.additionalContexts &&
      hookResult.additionalContexts.length > 0
    ) {
      additionalContexts.push(...hookResult.additionalContexts)
    }
    if (hookResult.initialUserMessage) {
      pendingInitialUserMessage = hookResult.initialUserMessage
    }
    if (hookResult.watchPaths && hookResult.watchPaths.length > 0) {
      allWatchPaths.push(...hookResult.watchPaths)
    }
  }
// 逐个收集钩子产物：消息、附加上下文、待监视路径，以及一次性的初始用户消息。

  if (allWatchPaths.length > 0) {
    updateWatchPaths(allWatchPaths)
  }

  // If hooks provided additional context, add it as a message
  if (additionalContexts.length > 0) {
    const contextMessage = createAttachmentMessage({
      type: 'hook_additional_context',
      content: additionalContexts,
      hookName: 'SessionStart',
      toolUseID: 'SessionStart',
      hookEvent: 'SessionStart',
    })
    hookMessages.push(contextMessage)
  }
// 若钩子提供了附加上下文，就包成一条 hook_additional_context 附件消息追加进去。

  return hookMessages
}
// 返回本轮会话启动钩子产出的全部消息。

export async function processSetupHooks(
  trigger: 'init' | 'maintenance',
  { forceSyncExecution }: { forceSyncExecution?: boolean } = {},
): Promise<HookResultMessage[]> {
// Setup 钩子入口（init 与 maintenance 两种触发）：逻辑与上面的会话启动钩子几乎一致，但只收集消息与上下文。
  // Same rationale as processSessionStartHooks above.
  if (isBareMode()) {
    return []
  }
  const hookMessages: HookResultMessage[] = []
  const additionalContexts: string[] = []

  if (shouldAllowManagedHooksOnly()) {
    logForDebugging('Skipping plugin hooks - allowManagedHooksOnly is enabled')
  } else {
    try {
      await loadPluginHooks()
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      logForDebugging(
        `Warning: Failed to load plugin hooks. Setup hooks from plugins will not execute. Error: ${errorMessage}`,
        { level: 'warn' },
      )
    }
  }

  for await (const hookResult of executeSetupHooks(
    trigger,
    undefined,
    undefined,
    forceSyncExecution,
  )) {
    if (hookResult.message) {
      hookMessages.push(hookResult.message)
    }
    if (
      hookResult.additionalContexts &&
      hookResult.additionalContexts.length > 0
    ) {
      additionalContexts.push(...hookResult.additionalContexts)
    }
  }

  if (additionalContexts.length > 0) {
    const contextMessage = createAttachmentMessage({
      type: 'hook_additional_context',
      content: additionalContexts,
      hookName: 'Setup',
      toolUseID: 'Setup',
      hookEvent: 'Setup',
    })
    hookMessages.push(contextMessage)
  }

  return hookMessages
}
// 返回 Setup 钩子的全部消息；同样在 bare 模式或插件钩子加载失败时优雅降级。
