import type { StructuredPatchHunk } from 'diff'
import { useMemo, useRef } from 'react'
import type { FileEditOutput } from '../tools/FileEditTool/types.js'
import type { Output as FileWriteOutput } from '../tools/FileWriteTool/FileWriteTool.js'
import type { Message } from '../types/message.js'

export type TurnFileDiff = {
  filePath: string
  hunks: StructuredPatchHunk[]
  isNewFile: boolean
  linesAdded: number
  linesRemoved: number
}

export type TurnDiff = {
  turnIndex: number
  userPromptPreview: string
  timestamp: string
  files: Map<string, TurnFileDiff>
  stats: {
    filesChanged: number
    linesAdded: number
    linesRemoved: number
  }
}

type FileEditResult = FileEditOutput | FileWriteOutput

type TurnDiffCache = {
  completedTurns: TurnDiff[]
  currentTurn: TurnDiff | null
  lastProcessedIndex: number
  lastTurnIndex: number
}
// 缓存四件套：已完成回合数组、进行中回合、已处理到的消息下标、
// 回合计数。全部活在 ref 里，不触发渲染。

function isFileEditResult(result: unknown): result is FileEditResult {
  if (!result || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  // FileEditTool: has structuredPatch with content
  // FileWriteTool (update): has structuredPatch with content
  // FileWriteTool (create): has type='create' and content (structuredPatch is empty)
  const hasFilePath = typeof r.filePath === 'string'
  const hasStructuredPatch =
    Array.isArray(r.structuredPatch) && r.structuredPatch.length > 0
  const isNewFile = r.type === 'create' && typeof r.content === 'string'
// 新建文件没有 structuredPatch（没有旧内容可比），
// 靠 type='create' + content 识别——这条分支决定后面合成 hunk。
  return hasFilePath && (hasStructuredPatch || isNewFile)
}
// 两个工具的输出形状不同（FileEditTool 无 type 字段），
// 用鸭子类型判定，避免 import 具体类型做强转。

function isFileWriteOutput(result: FileEditResult): result is FileWriteOutput {
  return (
    'type' in result && (result.type === 'create' || result.type === 'update')
  )
}
// 只用于拿 create 分支的 content：update 分支的 content 是全量旧文，
// 不需要。

function countHunkLines(hunks: StructuredPatchHunk[]): {
  added: number
  removed: number
} {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }
  return { added, removed }
}
// 行数统计只数字符级 +/− 前缀：diff 库的 hunk.lines 已含上下文行，
// 不带 + 或 − 的就是上下文，不计入。

function getUserPromptPreview(message: Message): string {
  if (message.type !== 'user') return ''
  const content = message.message.content
  const text = typeof content === 'string' ? content : ''
  // Truncate to ~30 chars
// 预览截断到 30 字符：slice(0,29) 加省略号保持总长 30。
  if (text.length <= 30) return text
  return text.slice(0, 29) + '…'
}

function computeTurnStats(turn: TurnDiff): void {
  let totalAdded = 0
  let totalRemoved = 0
  for (const file of turn.files.values()) {
    totalAdded += file.linesAdded
    totalRemoved += file.linesRemoved
  }
  turn.stats = {
    filesChanged: turn.files.size,
    linesAdded: totalAdded,
    linesRemoved: totalRemoved,
  }
}
// stats 是派生值：每次文件表变化都全量重算，
// 不增量维护（turn.files 是 Map，遍历便宜）。

/**
 * Extract turn-based diffs from messages.
 * A turn is defined as a user prompt followed by assistant responses and tool results.
 * Each turn with file edits is included in the result.
 *
 * Uses incremental accumulation - only processes new messages since last render.
 */
// 从消息流里提取「按回合的文件 diff」。一个回合 = 一条用户提示 +
// 随后的 assistant 响应和工具结果。只返回含文件编辑的回合。
// 增量累计：每帧只处理自上次以来的新消息。
export function useTurnDiffs(messages: Message[]): TurnDiff[] {
  const cache = useRef<TurnDiffCache>({
    completedTurns: [],
    currentTurn: null,
    lastProcessedIndex: 0,
    lastTurnIndex: 0,
  })
// useRef 而不是 useState：缓存是纯计算中间态，
// 放 state 里会多一次渲染。

  return useMemo(() => {
    const c = cache.current

    // Reset if messages shrunk (user rewound conversation)
// 回退检测：用户 rewound 对话后消息变短，全量缓存作废重来。
    if (messages.length < c.lastProcessedIndex) {
      c.completedTurns = []
      c.currentTurn = null
      c.lastProcessedIndex = 0
      c.lastTurnIndex = 0
    }

    // Process only new messages
    for (let i = c.lastProcessedIndex; i < messages.length; i++) {
// 只从 lastProcessedIndex 开始扫：同一批消息重复渲染不重算，
// 这是 useMemo 内做增量的关键。
      const message = messages[i]
      if (!message || message.type !== 'user') continue
// 跳过非 user 消息：只有 user 消息能开新回合。

      // Check if this is a user prompt (not a tool result)
// tool_result 也是 user 型消息（API 结构如此），
// 靠 toolUseResult 字段或 content[0].type 识别，不当成新回合。
      const isToolResult =
        message.toolUseResult ||
        (Array.isArray(message.message.content) &&
          message.message.content[0]?.type === 'tool_result')

      if (!isToolResult && !message.isMeta) {
// 双重排除：工具结果 + isMeta（系统注入的伪 user 消息）。
        // Start a new turn on user prompt
        if (c.currentTurn && c.currentTurn.files.size > 0) {
          computeTurnStats(c.currentTurn)
          c.completedTurns.push(c.currentTurn)
        }

        c.lastTurnIndex++
        c.currentTurn = {
          turnIndex: c.lastTurnIndex,
          userPromptPreview: getUserPromptPreview(message),
          timestamp: message.timestamp,
          files: new Map(),
          stats: { filesChanged: 0, linesAdded: 0, linesRemoved: 0 },
        }
      } else if (c.currentTurn && message.toolUseResult) {
// 文件编辑只从 toolUseResult 里收集：assistant 消息里的 tool_use
// 只有输入没有结果，没有 diff 可算。
        // Collect file edits from tool results
        const result = message.toolUseResult
        if (isFileEditResult(result)) {
          const { filePath, structuredPatch } = result
          const isNewFile = 'type' in result && result.type === 'create'

          // Get or create file entry
          let fileEntry = c.currentTurn.files.get(filePath)
          if (!fileEntry) {
            fileEntry = {
              filePath,
              hunks: [],
              isNewFile,
              linesAdded: 0,
              linesRemoved: 0,
            }
            c.currentTurn.files.set(filePath, fileEntry)
          }
// 同文件在一个回合里可能被编辑多次：Map 按路径聚合成一个条目，
// hunks 顺序追加，行数累加。

          // For new files, generate synthetic hunk from content
          if (
            isNewFile &&
            structuredPatch.length === 0 &&
            isFileWriteOutput(result)
          ) {
            const content = result.content
            const lines = content.split('\n')
            const syntheticHunk: StructuredPatchHunk = {
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: lines.length,
              lines: lines.map(l => '+' + l),
// 新建文件合成一个「全是 +」的 hunk：oldStart/oldLines 为 0，
// 让 diff 视图把创建也渲染成新增块，无需特判。
            }
            fileEntry.hunks.push(syntheticHunk)
            fileEntry.linesAdded += lines.length
// 合成分支直接按 content 行数计 added——这些行没有真实 hunk 可数。
          } else {
            // Append hunks (same file may be edited multiple times in a turn)
            fileEntry.hunks.push(...structuredPatch)

            // Update line counts
            const { added, removed } = countHunkLines(structuredPatch)
            fileEntry.linesAdded += added
            fileEntry.linesRemoved += removed
          }
// 常规分支：hunks 原样追加，行数按 +/− 前缀统计。

          // If file was created and then edited, it's still a new file
          if (isNewFile) {
            fileEntry.isNewFile = true
          }
// 先 create 后 edit 的文件仍标记 isNewFile：
// 视图按「新文件」渲染（不带删除侧）。
        }
      }
    }

    c.lastProcessedIndex = messages.length
// 推进游标到消息总数：即使本帧没有新 user 消息也推进，
// 否则下一帧会重复扫同一段。

    // Build result: completed turns + current turn if it has files
    const result = [...c.completedTurns]
    if (c.currentTurn && c.currentTurn.files.size > 0) {
      // Compute stats for current turn before including
      computeTurnStats(c.currentTurn)
      result.push(c.currentTurn)
    }
// 当前回合也进结果：这一轮正在进行的编辑要实时可见。

    // Return in reverse order (most recent first)
    return result.reverse()
  }, [messages])
// reverse 成「最新在前」：UI 是倒序时间线。
// 注意返回的是新数组，cache 里的 completedTurns 顺序不变。
}
