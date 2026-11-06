/**
 * Vim Motion Functions
 *
 * Pure functions for resolving vim motions to cursor positions.
 */

import type { Cursor } from '../utils/Cursor.js'
// 导入 Cursor 类型（光标的纯计算抽象）

/**
 * Resolve a motion to a target cursor position.
 * Does not modify anything - pure calculation.
 */
export function resolveMotion(
// resolveMotion：按 count 重复应用单步动作，纯计算不修改任何状态
  key: string,
  cursor: Cursor,
  count: number,
): Cursor {
  let result = cursor
  for (let i = 0; i < count; i++) {
// 循环 count 次，若某步光标不再移动则提前结束
    const next = applySingleMotion(key, result)
    if (next.equals(result)) break
    result = next
  }
  return result
}

/**
 * Apply a single motion step.
 */
function applySingleMotion(key: string, cursor: Cursor): Cursor {
// applySingleMotion：单步动作查表，把按键映射到 Cursor 方法
  switch (key) {
    case 'h':
      return cursor.left()
// h / l：左 / 右移动一个字符
    case 'l':
      return cursor.right()
    case 'j':
      return cursor.downLogicalLine()
// j / k：按逻辑行上 / 下移动
    case 'k':
      return cursor.upLogicalLine()
    case 'gj':
      return cursor.down()
// gj / gk：按屏幕行（视觉行）上 / 下移动
    case 'gk':
      return cursor.up()
    case 'w':
// w / b / e：按 vim 词（word）前跳 / 后跳 / 词尾
      return cursor.nextVimWord()
    case 'b':
      return cursor.prevVimWord()
    case 'e':
      return cursor.endOfVimWord()
// e：跳到 vim 词的结尾（含终点字符）
    case 'W':
      return cursor.nextWORD()
    case 'B':
      return cursor.prevWORD()
    case 'E':
      return cursor.endOfWORD()
    case '0':
      return cursor.startOfLogicalLine()
// 0 / ^ / $：行首 / 首个非空白 / 行尾
    case '^':
      return cursor.firstNonBlankInLogicalLine()
    case '$':
      return cursor.endOfLogicalLine()
// $：跳到逻辑行末尾
    case 'G':
      return cursor.startOfLastLine()
// G：跳到最后一行的行首
    default:
      return cursor
  }
}

/**
 * Check if a motion is inclusive (includes character at destination).
 */
export function isInclusiveMotion(key: string): boolean {
// isInclusiveMotion：判定动作是否含终点字符（e / E / $）
  return 'eE$'.includes(key)
}

/**
 * Check if a motion is linewise (operates on full lines when used with operators).
 * Note: gj/gk are characterwise exclusive per `:help gj`, not linewise.
 */
export function isLinewiseMotion(key: string): boolean {
// isLinewiseMotion：判定动作是否按整行操作（j / k / G / gg）
  return 'jkG'.includes(key) || key === 'gg'
}
