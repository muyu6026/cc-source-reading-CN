import chalk from 'chalk'
import { ctrlOToExpand } from '../components/CtrlOToExpand.js'
import { stringWidth } from '../ink/stringWidth.js'
import sliceAnsi from './sliceAnsi.js'
// 导入 chalk 着色、展开提示、字符串宽度计算与 ANSI 安全切片工具。

// Text rendering utilities for terminal display
const MAX_LINES_TO_SHOW = 3
// Account for MessageResponse prefix ("  ⎿ " = 5 chars) + parent width
// reduction (columns - 5 in tool result rendering)
const PADDING_TO_PREVENT_OVERFLOW = 10
// 终端文本渲染常量：最多显示 3 行，并预留 10 字符内边距避免与消息前缀、父级缩进冲突。

/**
 * Inserts newlines in a string to wrap it at the specified width.
 * Uses ANSI-aware slicing to avoid splitting escape sequences.
 * @param text The text to wrap.
 * @param wrapWidth The width at which to wrap lines (in visible characters).
 * @returns The wrapped text.
 */
function wrapText(
  text: string,
  wrapWidth: number,
): { aboveTheFold: string; remainingLines: number } {
  const lines = text.split('\n')
  const wrappedLines: string[] = []

  for (const line of lines) {
    const visibleWidth = stringWidth(line)
    if (visibleWidth <= wrapWidth) {
      wrappedLines.push(line.trimEnd())
    } else {
      // Break long lines into chunks of wrapWidth visible characters
      // using ANSI-aware slicing to preserve escape sequences
      let position = 0
      while (position < visibleWidth) {
        const chunk = sliceAnsi(line, position, position + wrapWidth)
        wrappedLines.push(chunk.trimEnd())
        position += wrapWidth
      }
    }
  }

  const remainingLines = wrappedLines.length - MAX_LINES_TO_SHOW

  // If there's only 1 line after the fold, show it directly
  // instead of showing "... +1 line (ctrl+o to expand)"
  if (remainingLines === 1) {
    return {
      aboveTheFold: wrappedLines
        .slice(0, MAX_LINES_TO_SHOW + 1)
        .join('\n')
        .trimEnd(),
      remainingLines: 0, // All lines are shown, nothing remaining
    }
  }

  // Otherwise show the standard MAX_LINES_TO_SHOW
  return {
    aboveTheFold: wrappedLines.slice(0, MAX_LINES_TO_SHOW).join('\n').trimEnd(),
    remainingLines: Math.max(0, remainingLines),
  }
}
// wrapText：按可见宽度把文本换行（ANSI 感知，不切断转义序列），返回折叠区内容与剩余行数。

/**
 * Renders the content with line-based truncation for terminal display.
 * If the content exceeds the maximum number of lines, it truncates the content
 * and adds a message indicating the number of additional lines.
 * @param content The content to render.
 * @param terminalWidth Terminal width for wrapping lines.
 * @returns The rendered content with truncation if needed.
 */
export function renderTruncatedContent(
  content: string,
  terminalWidth: number,
  suppressExpandHint = false,
): string {
  const trimmedContent = content.trimEnd()
  if (!trimmedContent) {
    return ''
  }

  const wrapWidth = Math.max(terminalWidth - PADDING_TO_PREVENT_OVERFLOW, 10)

  // Only process enough content for the visible lines. Avoids O(n) wrapping
  // on huge outputs (e.g. 64MB binary dumps that cause 382K-row screens).
  const maxChars = MAX_LINES_TO_SHOW * wrapWidth * 4
  const preTruncated = trimmedContent.length > maxChars
  const contentForWrapping = preTruncated
    ? trimmedContent.slice(0, maxChars)
    : trimmedContent

  const { aboveTheFold, remainingLines } = wrapText(
    contentForWrapping,
    wrapWidth,
  )

  const estimatedRemaining = preTruncated
    ? Math.max(
        remainingLines,
        Math.ceil(trimmedContent.length / wrapWidth) - MAX_LINES_TO_SHOW,
      )
    : remainingLines

  return [
    aboveTheFold,
    estimatedRemaining > 0
      ? chalk.dim(
          `… +${estimatedRemaining} lines${suppressExpandHint ? '' : ` ${ctrlOToExpand()}`}`,
        )
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}
// renderTruncatedContent：对超长输出做按行截断，超出部分用暗色「…+N 行（ctrl+o 展开）」提示，并限制只处理可见区附近的字符以免 O(n) 卡顿。

/** Fast check: would OutputLine truncate this content? Counts raw newlines
 *  only (ignores terminal-width wrapping), so it may return false for a single
 *  very long line that wraps past 3 visual rows — acceptable, since the common
 *  case is multi-line output. */
export function isOutputLineTruncated(content: string): boolean {
  let pos = 0
  // Need more than MAX_LINES_TO_SHOW newlines (content fills > 3 lines).
  // The +1 accounts for wrapText showing an extra line when remainingLines==1.
  for (let i = 0; i <= MAX_LINES_TO_SHOW; i++) {
    pos = content.indexOf('\n', pos)
    if (pos === -1) return false
    pos++
  }
  // A trailing newline is a terminator, not a new line — match
  // renderTruncatedContent's trimEnd() behavior.
  return pos < content.length
}
// isOutputLineTruncated：快速判断内容是否会被截断——只数原始换行数，忽略宽度换行，对多行输出这类常见情形足够准。
