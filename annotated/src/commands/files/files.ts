import { relative } from 'path'
// `/files` 命令：列出当前上下文中已读取的文件清单，便于用户确认哪些文件被纳入对话。
import type { ToolUseContext } from '../../Tool.js'
import type { LocalCommandResult } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { cacheKeys } from '../../utils/fileStateCache.js'

export async function call(
  _args: string,
  context: ToolUseContext,
): Promise<LocalCommandResult> {
// `call` 实现：从工具上下文取出已读文件的状态键集合，空则提示无文件。
  const files = context.readFileState ? cacheKeys(context.readFileState) : []
// 从上下文的读文件状态里拿缓存键，空数组表示当前没有文件。

  if (files.length === 0) {
    return { type: 'text' as const, value: 'No files in context' }
  }

  const fileList = files.map(file => relative(getCwd(), file)).join('\n')
// 把绝对路径转成相对工作目录的路径，拼成可读的文件清单返回。
  return { type: 'text' as const, value: `Files in context:\n${fileList}` }
}
