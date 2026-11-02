// hook 辅助工具集：把「hook 返回值」统一收敛成结构化输出。核心是给 Stop 类 hook 装一个强制校验钩子，要求模型必须调用合成输出工具才算完成，避免只写纯文本就结束。
import { z } from 'zod/v4'
import type { Tool } from '../../Tool.js'
import {
  SYNTHETIC_OUTPUT_TOOL_NAME,
  SyntheticOutputTool,
} from '../../tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { substituteArguments } from '../argumentSubstitution.js'
import { lazySchema } from '../lazySchema.js'
import type { SetAppState } from '../messageQueueManager.js'
import { hasSuccessfulToolCall } from '../messages.js'
import { addFunctionHook } from './sessionHooks.js'

/**
 * Schema for hook responses (shared by prompt and agent hooks)
 */
export const hookResponseSchema = lazySchema(() =>
  z.object({
    ok: z.boolean().describe('Whether the condition was met'),
    reason: z
      .string()
      .describe('Reason, if the condition was not met')
      .optional(),
  }),
)
// hookResponseSchema 是所有 hook 响应的统一形状：ok 表示条件是否满足，reason 只在失败时给出原因。用 lazySchema 包一层是延迟构造 zod schema，避免模块加载期就付出构造开销。

/**
 * Add hook input JSON to prompt, either replacing $ARGUMENTS placeholder or appending.
 * Also supports indexed arguments like $ARGUMENTS[0], $ARGUMENTS[1], or shorthand $0, $1, etc.
 */
export function addArgumentsToPrompt(
  prompt: string,
  jsonInput: string,
): string {
  return substituteArguments(prompt, jsonInput)
}
// addArgumentsToPrompt 本身没有逻辑，只是把拼接工作转交给 substituteArguments。这样 hook 的入参注入规则（替换 $ARGUMENTS 占位符、支持 $0 这类简写下标）与技能命令共用同一份实现，不会两处语义漂移。

/**
 * Create a StructuredOutput tool configured for hook responses.
 * Reusable by agent hooks and background verification.
 */
export function createStructuredOutputTool(): Tool {
  return {
    ...SyntheticOutputTool,
    inputSchema: hookResponseSchema(),
    inputJSONSchema: {
      type: 'object',
      properties: {
        ok: {
          type: 'boolean',
          description: 'Whether the condition was met',
        },
        reason: {
          type: 'string',
          description: 'Reason, if the condition was not met',
        },
      },
      required: ['ok'],
      additionalProperties: false,
    },
    async prompt(): Promise<string> {
      return `Use this tool to return your verification result. You MUST call this tool exactly once at the end of your response.`
    },
  }
}
// createStructuredOutputTool 复用 SyntheticOutputTool 的定义，只把输入 schema 换成 hook 响应形状。返回值被 agent hook 与后台校验共用，所以提示语写死了「必须且只能调用一次」，否则模型可能反复调用。

/**
 * Register a function hook that enforces structured output via SyntheticOutputTool.
 * Used by ask.tsx, execAgentHook.ts, and background verification.
 */
export function registerStructuredOutputEnforcement(
  setAppState: SetAppState,
  sessionId: string,
): void {
  addFunctionHook(
    setAppState,
    sessionId,
    'Stop',
    '', // No matcher - applies to all stops
    messages => hasSuccessfulToolCall(messages, SYNTHETIC_OUTPUT_TOOL_NAME),
    `You MUST call the ${SYNTHETIC_OUTPUT_TOOL_NAME} tool to complete this request. Call this tool now.`,
    { timeout: 5000 },
  )
}
// registerStructuredOutputEnforcement 注册的是一个 Stop 钩子：matcher 传空字符串表示对所有停止场景生效；判定函数检查消息里是否已有合成输出工具的成功调用，没有就以固定话术把模型拉回来，并给了 5 秒超时。
