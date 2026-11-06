import type { LocalCommandResult } from '../../commands.js'
// 引入本地命令结果类型与工具上下文类型。
import type { ToolUseContext } from '../../Tool.js'

export async function call(
// 命令实现 `call`：打开消息选择器后返回一个「跳过」结果，不向对话追加任何消息。
  _args: string,
  context: ToolUseContext,
): Promise<LocalCommandResult> {
  if (context.openMessageSelector) {
// 若上下文提供了消息选择器就打开它，供用户挑选回滚目标点。
    context.openMessageSelector()
  }
  // Return a skip message to not append any messages.
  return { type: 'skip' }
// 返回 `{ type: 'skip' }` 使命令本身不产生新消息。
}
