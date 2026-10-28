import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import { FILE_READ_TOOL_NAME } from '../tools/FileReadTool/prompt.js'
import { GREP_TOOL_NAME } from '../tools/GrepTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from '../tools/WebFetchTool/prompt.js'
import type { ContextData } from './analyzeContext.js'
import { getDisplayPath } from './file.js'
import { formatTokens } from './format.js'

// --

export type SuggestionSeverity = 'info' | 'warning'
// 建议分两级：普通提示 info 与告警 warning

export type ContextSuggestion = {
  severity: SuggestionSeverity
  title: string
  detail: string
  /** Estimated tokens that could be saved */
  savingsTokens?: number
}
// 单条建议的结构：级别、标题、详情与可省下的 token 估计

// Thresholds for triggering suggestions
const LARGE_TOOL_RESULT_PERCENT = 15 // tool results > 15% of context
const LARGE_TOOL_RESULT_TOKENS = 10_000
const READ_BLOAT_PERCENT = 5 // Read results > 5% of context
const NEAR_CAPACITY_PERCENT = 80
const MEMORY_HIGH_PERCENT = 5
const MEMORY_HIGH_TOKENS = 5_000
// 触发建议的若干阈值：工具结果占比、读文件占比、接近容量、记忆占比等

// --

// 主入口：依次跑五类检查，最后按「告警优先、可省 token 降序」排序
export function generateContextSuggestions(
  data: ContextData,
): ContextSuggestion[] {
  const suggestions: ContextSuggestion[] = []

  checkNearCapacity(data, suggestions)
  checkLargeToolResults(data, suggestions)
  checkReadResultBloat(data, suggestions)
  checkMemoryBloat(data, suggestions)
  checkAutoCompactDisabled(data, suggestions)

  // Sort: warnings first, then by savings descending
  suggestions.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === 'warning' ? -1 : 1
    }
    return (b.savingsTokens ?? 0) - (a.savingsTokens ?? 0)
  })

  return suggestions
}

// --

// 接近容量上限时给告警，提示用 /compact 控制保留内容
function checkNearCapacity(
  data: ContextData,
  suggestions: ContextSuggestion[],
): void {
  if (data.percentage >= NEAR_CAPACITY_PERCENT) {
    suggestions.push({
      severity: 'warning',
      title: `Context is ${data.percentage}% full`,
      detail: data.isAutoCompactEnabled
        ? 'Autocompact will trigger soon, which discards older messages. Use /compact now to control what gets kept.'
        : 'Autocompact is disabled. Use /compact to free space, or enable autocompact in /config.',
    })
  }
}

// 逐个工具统计 token 占用，超阈值的按工具类型给裁剪建议
function checkLargeToolResults(
  data: ContextData,
  suggestions: ContextSuggestion[],
): void {
  if (!data.messageBreakdown) return

  for (const tool of data.messageBreakdown.toolCallsByType) {
    const totalToolTokens = tool.callTokens + tool.resultTokens
    const percent = (totalToolTokens / data.rawMaxTokens) * 100

    if (
      percent < LARGE_TOOL_RESULT_PERCENT ||
      totalToolTokens < LARGE_TOOL_RESULT_TOKENS
    ) {
      continue
    }

    const suggestion = getLargeToolSuggestion(
      tool.name,
      totalToolTokens,
      percent,
    )
    if (suggestion) {
      suggestions.push(suggestion)
    }
  }
}

// 按工具类型生成对应的裁剪建议：Bash 走管道、Read 用偏移、Grep 加 glob、WebFetch 只取要点
function getLargeToolSuggestion(
  toolName: string,
  tokens: number,
  percent: number,
): ContextSuggestion | null {
  const tokenStr = formatTokens(tokens)

  switch (toolName) {
    case BASH_TOOL_NAME:
      return {
        severity: 'warning',
        title: `Bash results using ${tokenStr} tokens (${percent.toFixed(0)}%)`,
        detail:
          'Pipe output through head, tail, or grep to reduce result size. Avoid cat on large files \u2014 use Read with offset/limit instead.',
        savingsTokens: Math.floor(tokens * 0.5),
      }
    case FILE_READ_TOOL_NAME:
      return {
        severity: 'info',
        title: `Read results using ${tokenStr} tokens (${percent.toFixed(0)}%)`,
        detail:
          'Use offset and limit parameters to read only the sections you need. Avoid re-reading entire files when you only need a few lines.',
        savingsTokens: Math.floor(tokens * 0.3),
      }
    case GREP_TOOL_NAME:
      return {
        severity: 'info',
        title: `Grep results using ${tokenStr} tokens (${percent.toFixed(0)}%)`,
        detail:
          'Add more specific patterns or use the glob or type parameter to narrow file types. Consider Glob for file discovery instead of Grep.',
        savingsTokens: Math.floor(tokens * 0.3),
      }
    case WEB_FETCH_TOOL_NAME:
      return {
        severity: 'info',
        title: `WebFetch results using ${tokenStr} tokens (${percent.toFixed(0)}%)`,
        detail:
          'Web page content can be very large. Consider extracting only the specific information needed.',
        savingsTokens: Math.floor(tokens * 0.4),
      }
    default:
      if (percent >= 20) {
        return {
          severity: 'info',
          title: `${toolName} using ${tokenStr} tokens (${percent.toFixed(0)}%)`,
          detail: `This tool is consuming a significant portion of context.`,
          savingsTokens: Math.floor(tokens * 0.2),
        }
      }
      return null
  }
}

// 读文件结果本身过大时的专项建议（与上面的工具阈值互补，避免重复报）
function checkReadResultBloat(
  data: ContextData,
  suggestions: ContextSuggestion[],
): void {
  if (!data.messageBreakdown) return

  const callsByType = data.messageBreakdown.toolCallsByType
  const readTool = callsByType.find(t => t.name === FILE_READ_TOOL_NAME)
  if (!readTool) return

  const totalReadTokens = readTool.callTokens + readTool.resultTokens
  const totalReadPercent = (totalReadTokens / data.rawMaxTokens) * 100
  const readPercent = (readTool.resultTokens / data.rawMaxTokens) * 100

  // Skip if already covered by checkLargeToolResults (>= 15% band)
  if (
    totalReadPercent >= LARGE_TOOL_RESULT_PERCENT &&
    totalReadTokens >= LARGE_TOOL_RESULT_TOKENS
  ) {
    return
  }

  if (
    readPercent >= READ_BLOAT_PERCENT &&
    readTool.resultTokens >= LARGE_TOOL_RESULT_TOKENS
  ) {
    suggestions.push({
      severity: 'info',
      title: `File reads using ${formatTokens(readTool.resultTokens)} tokens (${readPercent.toFixed(0)}%)`,
      detail:
        'If you are re-reading files, consider referencing earlier reads. Use offset/limit for large files.',
      savingsTokens: Math.floor(readTool.resultTokens * 0.3),
    })
  }
}

// 记忆文件总占用过高时列出最大的几个，提示用 /memory 清理
function checkMemoryBloat(
  data: ContextData,
  suggestions: ContextSuggestion[],
): void {
  const totalMemoryTokens = data.memoryFiles.reduce(
    (sum, f) => sum + f.tokens,
    0,
  )
  const memoryPercent = (totalMemoryTokens / data.rawMaxTokens) * 100

  if (
    memoryPercent >= MEMORY_HIGH_PERCENT &&
    totalMemoryTokens >= MEMORY_HIGH_TOKENS
  ) {
    const largestFiles = [...data.memoryFiles]
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 3)
      .map(f => {
        const name = getDisplayPath(f.path)
        return `${name} (${formatTokens(f.tokens)})`
      })
      .join(', ')

    suggestions.push({
      severity: 'info',
      title: `Memory files using ${formatTokens(totalMemoryTokens)} tokens (${memoryPercent.toFixed(0)}%)`,
      detail: `Largest: ${largestFiles}. Use /memory to review and prune stale entries.`,
      savingsTokens: Math.floor(totalMemoryTokens * 0.3),
    })
  }
}

// 自动压缩被关且上下文已过半时，提醒开启以免撞上限丢对话
function checkAutoCompactDisabled(
  data: ContextData,
  suggestions: ContextSuggestion[],
): void {
  if (
    !data.isAutoCompactEnabled &&
    data.percentage >= 50 &&
    data.percentage < NEAR_CAPACITY_PERCENT
  ) {
    suggestions.push({
      severity: 'info',
      title: 'Autocompact is disabled',
      detail:
        'Without autocompact, you will hit context limits and lose the conversation. Enable it in /config or use /compact manually.',
    })
  }
}
