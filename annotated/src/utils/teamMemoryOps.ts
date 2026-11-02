import { isTeamMemFile } from '../memdir/teamMemPaths.js'
// 团队记忆相关的判定与文案：只做三件事——认出「这次工具调用碰的是团队记忆文件」、认出写与编辑、把计数拼成一句人话摘要。
import { FILE_EDIT_TOOL_NAME } from '../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../tools/FileWriteTool/prompt.js'

export { isTeamMemFile }
// 顺手转出去：真正判断路径归属的函数在 memdir/teamMemPaths，这里只做统一出口，调用方不用记住两处路径。

/**
 * Check if a search tool use targets team memory files by examining its path.
 */
export function isTeamMemorySearch(toolInput: unknown): boolean {
  const input = toolInput as
    | { path?: string; pattern?: string; glob?: string }
    | undefined
  if (!input) {
    return false
  }
  if (input.path && isTeamMemFile(input.path)) {
    return true
  }
  return false
}
// 搜索判定只看 path：grep 与 glob 的 pattern 是匹配内容，不是目标位置，因此不能用它判断是否落在团队记忆目录。

/**
 * Check if a Write or Edit tool use targets a team memory file.
 */
export function isTeamMemoryWriteOrEdit(
  toolName: string,
  toolInput: unknown,
): boolean {
  if (toolName !== FILE_WRITE_TOOL_NAME && toolName !== FILE_EDIT_TOOL_NAME) {
    return false
  }
  const input = toolInput as { file_path?: string; path?: string } | undefined
  const filePath = input?.file_path ?? input?.path
  return filePath !== undefined && isTeamMemFile(filePath)
}
// 写与编辑判定先卡工具名再取路径：两个工具的参数名一个叫 file_path 一个叫 path，这里统一兜住。

/**
 * Append team memory summary parts to the parts array.
 * Encapsulates all team memory verb/string logic for getSearchReadSummaryText.
 */
export function appendTeamMemorySummaryParts(
  memoryCounts: {
    teamMemoryReadCount?: number
    teamMemorySearchCount?: number
    teamMemoryWriteCount?: number
  },
  isActive: boolean,
  parts: string[],
): void {
  const teamReadCount = memoryCounts.teamMemoryReadCount ?? 0
  const teamSearchCount = memoryCounts.teamMemorySearchCount ?? 0
  const teamWriteCount = memoryCounts.teamMemoryWriteCount ?? 0
// 三个计数缺省归零：调用方可能只传其中一两个字段，这里补齐后下面的分支判断不必再判 undefined。
  if (teamReadCount > 0) {
    const verb = isActive
      ? parts.length === 0
        ? 'Recalling'
        : 'recalling'
      : parts.length === 0
        ? 'Recalled'
        : 'recalled'
    parts.push(
      `${verb} ${teamReadCount} team ${teamReadCount === 1 ? 'memory' : 'memories'}`,
    )
  }
// 动词分四态：进行中且是首句用大写动名词、进行中但已有前文用小写、已完成且首句用过去式大写、已完成续句用小写——目的是让摘要拼起来像一句连贯的话。
  if (teamSearchCount > 0) {
    const verb = isActive
      ? parts.length === 0
        ? 'Searching'
        : 'searching'
      : parts.length === 0
        ? 'Searched'
        : 'searched'
    parts.push(`${verb} team memories`)
  }
// 搜索不报条数：结果条数不稳定也不重要，只报「搜过团队记忆」这一事实。
  if (teamWriteCount > 0) {
    const verb = isActive
      ? parts.length === 0
        ? 'Writing'
        : 'writing'
      : parts.length === 0
        ? 'Wrote'
        : 'wrote'
    parts.push(
      `${verb} ${teamWriteCount} team ${teamWriteCount === 1 ? 'memory' : 'memories'}`,
    )
  }
}
// 写入摘要按单复数变形：1 条用 memory、多条用 memories，与读取分支保持同一套措辞规则。
