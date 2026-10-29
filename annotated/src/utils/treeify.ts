import figures from 'figures'
import { color } from '../components/design-system/color.js'
import type { Theme, ThemeName } from './theme.js'

export type TreeNode = {
  [key: string]: TreeNode | string | undefined
}
// TreeNode 是递归结构：键映射到子节点、字符串或空。

export type TreeifyOptions = {
  showValues?: boolean
  hideFunctions?: boolean
  useColors?: boolean
  themeName?: ThemeName
  treeCharColors?: {
    treeChar?: keyof Theme // Color for tree characters (├ └ │)
    key?: keyof Theme // Color for property names
    value?: keyof Theme // Color for values
  }
}
// TreeifyOptions 控制是否显示值、隐藏函数、使用颜色及主题名与各类字符配色。

type TreeCharacters = {
  branch: string
  lastBranch: string
  line: string
  empty: string
}
// TreeCharacters 定义分支、末分支、竖线与空位四种树形字符。

const DEFAULT_TREE_CHARS: TreeCharacters = {
  branch: figures.lineUpDownRight, // '├'
  lastBranch: figures.lineUpRight, // '└'
  line: figures.lineVertical, // '│'
  empty: ' ',
}
// DEFAULT_TREE_CHARS 用 figures 库提供的线形字符作为默认树形符号。

/**
 * Custom treeify implementation with Ink theme color support
 * Based on https://github.com/notatestuser/treeify
 */
// treeify 是带 Ink 主题色支持的自定义树形渲染实现，源自社区 treeify 项目。
export function treeify(obj: TreeNode, options: TreeifyOptions = {}): string {
  const {
    showValues = true,
    hideFunctions = false,
    themeName = 'dark',
    treeCharColors = {},
  } = options

  const lines: string[] = []
  const visited = new WeakSet<object>()

  function colorize(text: string, colorKey?: keyof Theme): string {
    if (!colorKey) return text
    return color(colorKey, themeName)(text)
  }
// colorize 按给定的主题键上色，无键则原样返回。

  function growBranch(
    node: TreeNode | string,
    prefix: string,
    _isLast: boolean,
    depth: number = 0,
  ): void {
    if (typeof node === 'string') {
      lines.push(prefix + colorize(node, treeCharColors.value))
      return
    }

    if (typeof node !== 'object' || node === null) {
      if (showValues) {
        const valueStr = String(node)
        lines.push(prefix + colorize(valueStr, treeCharColors.value))
      }
      return
    }

    // Check for circular references
    if (visited.has(node)) {
      lines.push(prefix + colorize('[Circular]', treeCharColors.value))
      return
    }
    visited.add(node)

    const keys = Object.keys(node).filter(key => {
      const value = node[key]
      if (hideFunctions && typeof value === 'function') return false
      return true
    })

    keys.forEach((key, index) => {
      const value = node[key]
      const isLastKey = index === keys.length - 1
      const nodePrefix = depth === 0 && index === 0 ? '' : prefix

      // Determine which tree character to use
      const treeChar = isLastKey
        ? DEFAULT_TREE_CHARS.lastBranch
        : DEFAULT_TREE_CHARS.branch
      const coloredTreeChar = colorize(treeChar, treeCharColors.treeChar)
      const coloredKey =
        key.trim() === '' ? '' : colorize(key, treeCharColors.key)

      let line =
        nodePrefix + coloredTreeChar + (coloredKey ? ' ' + coloredKey : '')

      // Check if we should add a colon (not for empty/whitespace keys)
      const shouldAddColon = key.trim() !== ''

      // Check for circular reference before recursing
      if (value && typeof value === 'object' && visited.has(value)) {
        const coloredValue = colorize('[Circular]', treeCharColors.value)
        lines.push(
          line + (shouldAddColon ? ': ' : line ? ' ' : '') + coloredValue,
        )
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        lines.push(line)
        // Calculate the continuation prefix for nested items
        const continuationChar = isLastKey
          ? DEFAULT_TREE_CHARS.empty
          : DEFAULT_TREE_CHARS.line
        const coloredContinuation = colorize(
          continuationChar,
          treeCharColors.treeChar,
        )
        const nextPrefix = nodePrefix + coloredContinuation + ' '
        growBranch(value, nextPrefix, isLastKey, depth + 1)
      } else if (Array.isArray(value)) {
        // Handle arrays
        lines.push(
          line +
            (shouldAddColon ? ': ' : line ? ' ' : '') +
            '[Array(' +
            value.length +
            ')]',
        )
      } else if (showValues) {
        // Add value if showValues is true
        const valueStr =
          typeof value === 'function' ? '[Function]' : String(value)
        const coloredValue = colorize(valueStr, treeCharColors.value)
        line += (shouldAddColon ? ': ' : line ? ' ' : '') + coloredValue
        lines.push(line)
      } else {
        lines.push(line)
      }
    })
  }
// growBranch 递归生长子树：先处理字符串与基础值，再处理循环引用、对象、数组与函数。

  // Start growing the tree
  const keys = Object.keys(obj)
  if (keys.length === 0) {
    return colorize('(empty)', treeCharColors.value)
  }
// 对空对象或单空键等特殊情况直接返回内置文案或特例字符串。

  // Special case for single empty/whitespace string key
  if (
    keys.length === 1 &&
    keys[0] !== undefined &&
    keys[0].trim() === '' &&
    typeof obj[keys[0]] === 'string'
  ) {
    const firstKey = keys[0]
    const coloredTreeChar = colorize(
      DEFAULT_TREE_CHARS.lastBranch,
      treeCharColors.treeChar,
    )
    const coloredValue = colorize(obj[firstKey] as string, treeCharColors.value)
    return coloredTreeChar + ' ' + coloredValue
  }
// 对单键且值为字符串的特殊情形直接拼出末分支加值。

  growBranch(obj, '', true)
  return lines.join('\n')
}
// treeify 收尾：从根开始生长并拼接所有行，返回带主题色的树形文本。
