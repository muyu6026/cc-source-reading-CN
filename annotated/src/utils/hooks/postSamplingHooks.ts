import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { toError } from '../errors.js'
import { logError } from '../log.js'
import type { SystemPrompt } from '../systemPromptType.js'

// 采样后钩子不写在 settings.json 里（目前），只供程序内部调用——它与 stop 钩子并列，是 REPL 钩子体系的两个内部入口之一。
// Post-sampling hook - not exposed in settings.json config (yet), only used programmatically

// Generic context for REPL hooks (both post-sampling and stop hooks)
// REPL 钩子的通用上下文类型，聚合完整消息历史、系统提示、用户/系统上下文、工具上下文与查询来源，供 post-sampling 与 stop 钩子共用。
export type REPLHookContext = {
  messages: Message[] // Full message history including assistant responses
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext
  querySource?: QuerySource
}

// 采样后钩子的函数签名：接收一个上下文对象，返回 Promise<void> 或 void（同步亦可）。
export type PostSamplingHook = (
  context: REPLHookContext,
) => Promise<void> | void

// Internal registry for post-sampling hooks
const postSamplingHooks: PostSamplingHook[] = []
// 模块级注册表：所有采样后钩子函数都压进这个数组，供后续统一遍历执行。

/**
 * Register a post-sampling hook that will be called after model sampling completes
 * This is an internal API not exposed through settings
 */
// 注册一个采样后钩子，追加到上面的注册表里，供模型采样完成后回调。
export function registerPostSamplingHook(hook: PostSamplingHook): void {
  postSamplingHooks.push(hook)
}

/**
 * Clear all registered post-sampling hooks (for testing)
 */
// 清空所有已注册的采样后钩子，主要给测试使用。
export function clearPostSamplingHooks(): void {
  postSamplingHooks.length = 0
}

/**
 * Execute all registered post-sampling hooks
 */
// 依次执行所有已注册的采样后钩子；任一钩子抛错只记录日志、不中断其余钩子，也不让整体失败。
export async function executePostSamplingHooks(
  messages: Message[],
  systemPrompt: SystemPrompt,
  userContext: { [k: string]: string },
  systemContext: { [k: string]: string },
  toolUseContext: ToolUseContext,
  querySource?: QuerySource,
): Promise<void> {
  const context: REPLHookContext = {
    messages,
    systemPrompt,
    userContext,
    systemContext,
    toolUseContext,
    querySource,
  }

  for (const hook of postSamplingHooks) {
    try {
      await hook(context)
    } catch (error) {
      // Log but don't fail on hook errors
      logError(toError(error))
    }
  }
}
// 执行函数收尾：遍历注册表逐一 await 钩子，单个失败被吞掉并记录，保证采样后处理永远不阻断主流程。
