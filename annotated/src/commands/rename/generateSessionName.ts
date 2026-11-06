import { queryHaiku } from '../../services/api/claude.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { safeParseJSON } from '../../utils/json.js'
import { extractTextContent } from '../../utils/messages.js'
import { extractConversationText } from '../../utils/sessionTitle.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
// 依赖：Haiku 查询、消息抽取、JSON 安全解析、会话标题抽取、系统提示类型转换、调试日志、错误格式化

export async function generateSessionName(
// 主函数：根据对话内容用 Haiku 生成 kebab-case 会话名，失败返回 null
  messages: Message[],
  signal: AbortSignal,
): Promise<string | null> {
  const conversationText = extractConversationText(messages)
// 先抽取对话文本，空则放弃
  if (!conversationText) {
    return null
  }

  try {
    const result = await queryHaiku({
// 调用 Haiku：系统提示要求生成 2-4 词 kebab-case 名称
      systemPrompt: asSystemPrompt([
        'Generate a short kebab-case name (2-4 words) that captures the main topic of this conversation. Use lowercase words separated by hyphens. Examples: "fix-login-bug", "add-auth-feature", "refactor-api-client", "debug-test-failures". Return JSON with a "name" field.',
      ]),
      userPrompt: conversationText,
      outputFormat: {
// 输出结构用 json_schema 约束 name 字段
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
      signal,
      options: {
        querySource: 'rename_generate_name',
        agents: [],
        isNonInteractiveSession: false,
        hasAppendSystemPrompt: false,
        mcpTools: [],
      },
    })
// queryHaiku 调用结束，拿到模型结果

    const content = extractTextContent(result.message.content)
// 抽取响应中的文本内容

    const response = safeParseJSON(content)
// 安全解析 JSON
    if (
      response &&
      typeof response === 'object' &&
      'name' in response &&
      typeof (response as { name: unknown }).name === 'string'
    ) {
      return (response as { name: string }).name
// 校验通过：name 存在且为字符串则返回
    }
    return null
// 校验失败返回 null
  } catch (error) {
// 异常分支：Haiku 超时 / 限流 / 网络错误按预期处理，仅记调试日志
    // Haiku timeout/rate-limit/network are expected operational failures —
    // logForDebugging, not logError. Called automatically on every 3rd bridge
    // message (initReplBridge.ts), so errors here would flood the error file.
    logForDebugging(`generateSessionName failed: ${errorMessage(error)}`, {
// 仅记录调试日志（每 3 条桥接消息自动调用，避免刷爆错误日志）
      level: 'error',
    })
    return null
  }
// catch 块结束返回 null
}
