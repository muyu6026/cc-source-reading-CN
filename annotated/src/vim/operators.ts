// 整份文件是纯函数加一个上下文对象：自身不持有状态，所有副作用都通过上下文回灌，于是可以脱离编辑器单测
/**
 * Vim Operator Functions
 *
 * Pure functions for executing vim operators (delete, change, yank, etc.)
 */

import { Cursor } from '../utils/Cursor.js'
import { firstGrapheme, lastGrapheme } from '../utils/intl.js'
import { countCharInString } from '../utils/stringUtils.js'
import {
  isInclusiveMotion,
  isLinewiseMotion,
  resolveMotion,
} from './motions.js'
import { findTextObject } from './textObjects.js'
import type {
  FindType,
  Operator,
  RecordedChange,
  TextObjScope,
} from './types.js'

/**
 * Context for operator execution.
 */
// 上下文是能力清单而不是数据袋：改文本、移光标、进插入模式、读写寄存器、记上次查找、记改动
export type OperatorContext = {
  cursor: Cursor
  text: string
  setText: (text: string) => void
  setOffset: (offset: number) => void
  enterInsert: (offset: number) => void
  getRegister: () => string
  setRegister: (content: string, linewise: boolean) => void
  getLastFind: () => { type: FindType; char: string } | null
  setLastFind: (type: FindType, char: string) => void
  recordChange: (change: RecordedChange) => void
}

/**
 * Execute an operator with a simple motion.
 */
// 操作符加普通动作：先算目标位置，再算范围，最后统一应用
export function executeOperatorMotion(
  op: Operator,
  motion: string,
  count: number,
  ctx: OperatorContext,
): void {
// 动作解析成目标光标，计数与行内边界在这一步已经处理掉了
  const target = resolveMotion(motion, ctx.cursor, count)
  if (target.equals(ctx.cursor)) return

// 范围计算集中在下面那个函数里，这里只关心三种结果：起点、终点、是否整行
  const range = getOperatorRange(ctx.cursor, target, motion, op, count)
  applyOperator(op, range.from, range.to, ctx, range.linewise)
// 每次执行都记一笔改动，点号重复就是靠这份记录重放的
  ctx.recordChange({ type: 'operator', op, motion, count })
}

/**
 * Execute an operator with a find motion.
 */
// 操作符加字符查找：前向、后向、前向停靠、后向停靠四种
export function executeOperatorFind(
  op: Operator,
  findType: FindType,
  char: string,
  count: number,
  ctx: OperatorContext,
): void {
// 找不到目标字符就整个放弃，既不移动光标也不写寄存器
  const targetOffset = ctx.cursor.findCharacter(char, findType, count)
  if (targetOffset === null) return

  const target = new Cursor(ctx.cursor.measuredText, targetOffset)
  const range = getOperatorRangeForFind(ctx.cursor, target, findType)

  applyOperator(op, range.from, range.to, ctx)
// 成功才更新上次查找，供分号与逗号复用
  ctx.setLastFind(findType, char)
  ctx.recordChange({ type: 'operatorFind', op, find: findType, char, count })
}

/**
 * Execute an operator with a text object.
 */
// 操作符加文本对象：按括号、引号、词等结构取范围
export function executeOperatorTextObj(
  op: Operator,
  scope: TextObjScope,
  objType: string,
  count: number,
  ctx: OperatorContext,
): void {
// 内部与周围的区别只体现在一个布尔参数上，范围计算交给文本对象模块
  const range = findTextObject(
    ctx.text,
    ctx.cursor.offset,
    objType,
    scope === 'inner',
  )
  if (!range) return

  applyOperator(op, range.start, range.end, ctx)
  ctx.recordChange({ type: 'operatorTextObj', op, objType, scope, count })
}

/**
 * Execute a line operation (dd, cc, yy).
 */
// 整行操作：双击式删除、修改、复制。这三者不解析动作，直接按逻辑行算范围
export function executeLineOp(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  // Calculate logical line by counting newlines before cursor offset
  // (cursor.getPosition() returns wrapped line which is wrong for this)
// 行号是数换行符得出的，不能用光标的位置接口：那个接口返回折行后的行号，长行上会算错
  const currentLine = countCharInString(text.slice(0, ctx.cursor.offset), '\n')
  const linesToAffect = Math.min(count, lines.length - currentLine)
  const lineStart = ctx.cursor.startOfLogicalLine().offset
  let lineEnd = lineStart
// 逐行向后走换行符，走到文件末尾就取全文长度
  for (let i = 0; i < linesToAffect; i++) {
    const nextNewline = text.indexOf('\n', lineEnd)
    lineEnd = nextNewline === -1 ? text.length : nextNewline + 1
  }

  let content = text.slice(lineStart, lineEnd)
  // Ensure linewise content ends with newline for paste detection
// 整行内容补一个结尾换行，粘贴时靠这个换行判断是不是整行内容
  if (!content.endsWith('\n')) {
    content = content + '\n'
  }
  ctx.setRegister(content, true)

// 复制只把光标移到行首，不动文本
  if (op === 'yank') {
    ctx.setOffset(lineStart)
  } else if (op === 'delete') {
    let deleteStart = lineStart
    const deleteEnd = lineEnd

    // If deleting to end of file and there's a preceding newline, include it
    // This ensures deleting the last line doesn't leave a trailing newline
// 删到文件末尾且前面有换行时，把那个换行一并带上，否则会留下一行空行
    if (
      deleteEnd === text.length &&
      deleteStart > 0 &&
      text[deleteStart - 1] === '\n'
    ) {
      deleteStart -= 1
    }

    const newText = text.slice(0, deleteStart) + text.slice(deleteEnd)
    ctx.setText(newText || '')
// 偏移封顶到最后一个字符的起点：光标不能停在字符之后，否则下一次插入会越界
    const maxOff = Math.max(
      0,
      newText.length - (lastGrapheme(newText).length || 1),
    )
    ctx.setOffset(Math.min(deleteStart, maxOff))
  } else if (op === 'change') {
    // For single line, just clear it
    if (lines.length === 1) {
      ctx.setText('')
      ctx.enterInsert(0)
    } else {
      // Delete all affected lines, replace with single empty line, enter insert
// 多行时把受影响的几行换成一个空行，再进插入模式——这才是改整行的语义
      const beforeLines = lines.slice(0, currentLine)
      const afterLines = lines.slice(currentLine + linesToAffect)
      const newText = [...beforeLines, '', ...afterLines].join('\n')
      ctx.setText(newText)
      ctx.enterInsert(lineStart)
    }
  }

// 记录里的动作名取操作符首字母，三个整行操作正好各自复用它
  ctx.recordChange({ type: 'operator', op, motion: op[0]!, count })
}

/**
 * Execute delete character (x command).
 */
// 删字符。按字形簇前进而不是按码元，否则会把表情符号或组合字符劈开
export function executeX(count: number, ctx: OperatorContext): void {
  const from = ctx.cursor.offset

  if (from >= ctx.text.length) return

  // Advance by graphemes, not code units
  let endCursor = ctx.cursor
// 用光标的右移接口走计数步，边界由它自己处理
  for (let i = 0; i < count && !endCursor.isAtEnd(); i++) {
    endCursor = endCursor.right()
  }
  const to = endCursor.offset

  const deleted = ctx.text.slice(from, to)
  const newText = ctx.text.slice(0, from) + ctx.text.slice(to)

  ctx.setRegister(deleted, false)
  ctx.setText(newText)
  const maxOff = Math.max(
    0,
    newText.length - (lastGrapheme(newText).length || 1),
  )
  ctx.setOffset(Math.min(from, maxOff))
  ctx.recordChange({ type: 'x', count })
}

/**
 * Execute replace character (r command).
 */
// 替换字符：把光标处的字符换成给定字符
export function executeReplace(
  char: string,
  count: number,
  ctx: OperatorContext,
): void {
  let offset = ctx.cursor.offset
  let newText = ctx.text

  for (let i = 0; i < count && offset < newText.length; i++) {
// 每次替换前量出当前字形簇的长度，替换后按新字符的长度前进
    const graphemeLen = firstGrapheme(newText.slice(offset)).length || 1
    newText =
      newText.slice(0, offset) + char + newText.slice(offset + graphemeLen)
    offset += char.length
  }

  ctx.setText(newText)
// 偏移退回新字符的长度：替换完光标停在最后一个被替换的字符上
  ctx.setOffset(Math.max(0, offset - char.length))
  ctx.recordChange({ type: 'replace', char, count })
}

/**
 * Execute toggle case (~ command).
 */
// 切换大小写，直到行尾或计数用尽
export function executeToggleCase(count: number, ctx: OperatorContext): void {
  const startOffset = ctx.cursor.offset

  if (startOffset >= ctx.text.length) return

  let newText = ctx.text
  let offset = startOffset
  let toggled = 0

  while (offset < newText.length && toggled < count) {
    const grapheme = firstGrapheme(newText.slice(offset))
    const graphemeLen = grapheme.length

// 这个判定同时处理了非字母：数字与符号转大写等于自身，于是走小写分支也等于自身，行为与 vim 一致
    const toggledGrapheme =
      grapheme === grapheme.toUpperCase()
        ? grapheme.toLowerCase()
        : grapheme.toUpperCase()

    newText =
      newText.slice(0, offset) +
      toggledGrapheme +
      newText.slice(offset + graphemeLen)
    offset += toggledGrapheme.length
    toggled++
  }

  ctx.setText(newText)
  // Cursor moves to position after the last toggled character
  // At end of line, cursor can be at the "end" position
  ctx.setOffset(offset)
  ctx.recordChange({ type: 'toggleCase', count })
}

/**
 * Execute join lines (J command).
 */
// 合并行：把下面几行接到当前行尾部
export function executeJoin(count: number, ctx: OperatorContext): void {
  const text = ctx.text
  const lines = text.split('\n')
  const { line: currentLine } = ctx.cursor.getPosition()

  if (currentLine >= lines.length - 1) return

  const linesToJoin = Math.min(count, lines.length - currentLine - 1)
  let joinedLine = lines[currentLine]!
  const cursorPos = joinedLine.length

  for (let i = 1; i <= linesToJoin; i++) {
// 被接上的行先去掉行首空白，vim 也是这么做的
    const nextLine = (lines[currentLine + i] ?? '').trimStart()
    if (nextLine.length > 0) {
      if (!joinedLine.endsWith(' ') && joinedLine.length > 0) {
        joinedLine += ' '
      }
      joinedLine += nextLine
    }
  }

  const newLines = [
    ...lines.slice(0, currentLine),
    joinedLine,
    ...lines.slice(currentLine + linesToJoin + 1),
  ]

  const newText = newLines.join('\n')
  ctx.setText(newText)
// 光标停在原当前行的末尾，而不是合并后的行尾
  ctx.setOffset(getLineStartOffset(newLines, currentLine) + cursorPos)
  ctx.recordChange({ type: 'join', count })
}

/**
 * Execute paste (p/P command).
 */
// 粘贴。寄存器里有没有结尾换行，就是判断整行粘贴的唯一依据
export function executePaste(
  after: boolean,
  count: number,
  ctx: OperatorContext,
): void {
  const register = ctx.getRegister()
  if (!register) return

// 这个约定让寄存器自带类型信息，省掉一个额外的标志位
  const isLinewise = register.endsWith('\n')
  const content = isLinewise ? register.slice(0, -1) : register

  if (isLinewise) {
    const text = ctx.text
    const lines = text.split('\n')
    const { line: currentLine } = ctx.cursor.getPosition()

    const insertLine = after ? currentLine + 1 : currentLine
    const contentLines = content.split('\n')
    const repeatedLines: string[] = []
    for (let i = 0; i < count; i++) {
      repeatedLines.push(...contentLines)
    }

    const newLines = [
      ...lines.slice(0, insertLine),
      ...repeatedLines,
      ...lines.slice(insertLine),
    ]

    const newText = newLines.join('\n')
    ctx.setText(newText)
    ctx.setOffset(getLineStartOffset(newLines, insertLine))
  } else {
// 内容按计数重复：整行粘贴是重复整段，行内粘贴是重复字符串
    const textToInsert = content.repeat(count)
    const insertPoint =
      after && ctx.cursor.offset < ctx.text.length
        ? ctx.cursor.measuredText.nextOffset(ctx.cursor.offset)
        : ctx.cursor.offset

    const newText =
      ctx.text.slice(0, insertPoint) +
      textToInsert +
      ctx.text.slice(insertPoint)
// 偏移落回粘贴内容的最后一个字符，这是 vim 的落点规则
    const lastGr = lastGrapheme(textToInsert)
    const newOffset = insertPoint + textToInsert.length - (lastGr.length || 1)

    ctx.setText(newText)
    ctx.setOffset(Math.max(insertPoint, newOffset))
  }
}

/**
 * Execute indent (>> command).
 */
// 缩进与反缩进。两格固定宽度，不读文件类型配置
export function executeIndent(
  dir: '>' | '<',
  count: number,
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  const { line: currentLine } = ctx.cursor.getPosition()
  const linesToAffect = Math.min(count, lines.length - currentLine)
  const indent = '  ' // Two spaces

  for (let i = 0; i < linesToAffect; i++) {
    const lineIdx = currentLine + i
    const line = lines[lineIdx] ?? ''

// 缩进就是在行首插两空格
    if (dir === '>') {
      lines[lineIdx] = indent + line
// 反缩进优先精确去掉两空格，其次去掉一个制表符
    } else if (line.startsWith(indent)) {
      lines[lineIdx] = line.slice(indent.length)
    } else if (line.startsWith('\t')) {
      lines[lineIdx] = line.slice(1)
    } else {
      // Remove as much leading whitespace as possible up to indent length
      let removed = 0
      let idx = 0
      while (
        idx < line.length &&
        removed < indent.length &&
        /\s/.test(line[idx]!)
      ) {
        removed++
        idx++
      }
      lines[lineIdx] = line.slice(idx)
    }
  }

  const newText = lines.join('\n')
  const currentLineText = lines[currentLine] ?? ''
// 改动后重新算行首空白宽度，光标跟着落到新的首个非空白字符上
  const firstNonBlank = (currentLineText.match(/^\s*/)?.[0] ?? '').length

  ctx.setText(newText)
  ctx.setOffset(getLineStartOffset(lines, currentLine) + firstNonBlank)
  ctx.recordChange({ type: 'indent', dir, count })
}

/**
 * Execute open line (o/O command).
 */
// 在当前行上方或下方开一行并进入插入模式
export function executeOpenLine(
  direction: 'above' | 'below',
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  const { line: currentLine } = ctx.cursor.getPosition()

  const insertLine = direction === 'below' ? currentLine + 1 : currentLine
  const newLines = [
    ...lines.slice(0, insertLine),
    '',
    ...lines.slice(insertLine),
  ]

  const newText = newLines.join('\n')
  ctx.setText(newText)
// 开行之后直接进插入模式，光标落在新行行首
  ctx.enterInsert(getLineStartOffset(newLines, insertLine))
  ctx.recordChange({ type: 'openLine', direction })
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Calculate the offset of a line's start position.
 */
function getLineStartOffset(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).join('\n').length + (lineIndex > 0 ? 1 : 0)
}

// 范围计算是这份文件的核心，四种情况依次处理
function getOperatorRange(
  cursor: Cursor,
  target: Cursor,
  motion: string,
  op: Operator,
  count: number,
): { from: number; to: number; linewise: boolean } {
  let from = Math.min(cursor.offset, target.offset)
  let to = Math.max(cursor.offset, target.offset)
  let linewise = false

// 改词的特例：改到当前词的词尾，而不是下一个词的词首，这与删词的落点不同
  // Special case: cw/cW changes to end of word, not start of next word
  if (op === 'change' && (motion === 'w' || motion === 'W')) {
    // For cw with count, move forward (count-1) words, then find end of that word
    let wordCursor = cursor
    for (let i = 0; i < count - 1; i++) {
      wordCursor =
        motion === 'w' ? wordCursor.nextVimWord() : wordCursor.nextWORD()
    }
    const wordEnd =
      motion === 'w' ? wordCursor.endOfVimWord() : wordCursor.endOfWORD()
    to = cursor.measuredText.nextOffset(wordEnd.offset)
// 整行动作把范围扩到整行：找到终点之后的第一个换行并把它带上
  } else if (isLinewiseMotion(motion)) {
    // Linewise motions extend to include entire lines
    linewise = true
    const text = cursor.text
    const nextNewline = text.indexOf('\n', to)
    if (nextNewline === -1) {
      // Deleting to end of file - include the preceding newline if exists
      to = text.length
      if (from > 0 && text[from - 1] === '\n') {
        from -= 1
      }
    } else {
      to = nextNewline + 1
    }
// 含尾动作要再前进一个字形簇，且只在向后选择时做——向前选择时终点已经在外面
  } else if (isInclusiveMotion(motion) && cursor.offset <= target.offset) {
    to = cursor.measuredText.nextOffset(to)
  }

// 把范围推到占位符之外：词动作可能落在图片引用的中间，只删一半会留下残片
  // Word motions can land inside an [Image #N] chip; extend the range to
  // cover the whole chip so dw/cw/yw never leave a partial placeholder.
  from = cursor.snapOutOfImageRef(from, 'start')
  to = cursor.snapOutOfImageRef(to, 'end')

  return { from, to, linewise }
}

/**
 * Get the range for a find-based operator.
 * Note: _findType is unused because Cursor.findCharacter already adjusts
 * the offset for t/T motions. All find types are treated as inclusive here.
 */
// 查找类的范围一律按含尾处理，因为光标查找接口已经把偏移调整过了
function getOperatorRangeForFind(
  cursor: Cursor,
  target: Cursor,
  _findType: FindType,
): { from: number; to: number } {
  const from = Math.min(cursor.offset, target.offset)
  const maxOffset = Math.max(cursor.offset, target.offset)
  const to = cursor.measuredText.nextOffset(maxOffset)
  return { from, to }
}

// 应用操作符：取内容进寄存器，再按类型决定是移光标、删文本还是进插入
function applyOperator(
  op: Operator,
  from: number,
  to: number,
  ctx: OperatorContext,
  linewise: boolean = false,
): void {
  let content = ctx.text.slice(from, to)
  // Ensure linewise content ends with newline for paste detection
  if (linewise && !content.endsWith('\n')) {
    content = content + '\n'
  }
  ctx.setRegister(content, linewise)

  if (op === 'yank') {
    ctx.setOffset(from)
  } else if (op === 'delete') {
    const newText = ctx.text.slice(0, from) + ctx.text.slice(to)
    ctx.setText(newText)
    const maxOff = Math.max(
      0,
      newText.length - (lastGrapheme(newText).length || 1),
    )
    ctx.setOffset(Math.min(from, maxOff))
// 修改是删完立刻进插入模式，这是它与删除的唯一区别
  } else if (op === 'change') {
    const newText = ctx.text.slice(0, from) + ctx.text.slice(to)
    ctx.setText(newText)
    ctx.enterInsert(from)
  }
}

// 跳到末行动作：计数为一表示没给计数，目标是文件末尾
export function executeOperatorG(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  // count=1 means no count given, target = end of file
  // otherwise target = line N
  const target =
    count === 1 ? ctx.cursor.startOfLastLine() : ctx.cursor.goToLine(count)

  if (target.equals(ctx.cursor)) return

  const range = getOperatorRange(ctx.cursor, target, 'G', op, count)
  applyOperator(op, range.from, range.to, ctx, range.linewise)
  ctx.recordChange({ type: 'operator', op, motion: 'G', count })
}

// 跳到首行动作同理，计数为一表示没给计数，目标是文件第一行
export function executeOperatorGg(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  // count=1 means no count given, target = first line
  // otherwise target = line N
  const target =
    count === 1 ? ctx.cursor.startOfFirstLine() : ctx.cursor.goToLine(count)

  if (target.equals(ctx.cursor)) return

  const range = getOperatorRange(ctx.cursor, target, 'gg', op, count)
  applyOperator(op, range.from, range.to, ctx, range.linewise)
  ctx.recordChange({ type: 'operator', op, motion: 'gg', count })
}
