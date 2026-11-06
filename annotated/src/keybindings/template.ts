/**
 * Keybindings template generator.
 * Generates a well-documented template file for ~/.claude/keybindings.json
 */

import { jsonStringify } from '../utils/slowOperations.js'
import { DEFAULT_BINDINGS } from './defaultBindings.js'
import {
  NON_REBINDABLE,
  normalizeKeyForComparison,
} from './reservedShortcuts.js'
import type { KeybindingBlock } from './types.js'

// 引入模板拼装依赖：JSON 序列化、默认绑定与保留键归一化工具。
/**
 * Filter out reserved shortcuts that cannot be rebound.
 * These would cause /doctor to warn, so we exclude them from the template.
 */
function filterReservedShortcuts(blocks: KeybindingBlock[]): KeybindingBlock[] {
  const reservedKeys = new Set(
    NON_REBINDABLE.map(r => normalizeKeyForComparison(r.key)),
  )

  return blocks
    .map(block => {
      const filteredBindings: Record<string, string | null> = {}
      for (const [key, action] of Object.entries(block.bindings)) {
        if (!reservedKeys.has(normalizeKeyForComparison(key))) {
          filteredBindings[key] = action
        }
      }
      return { context: block.context, bindings: filteredBindings }
    })
    .filter(block => Object.keys(block.bindings).length > 0)
}

/**
 * Generate a template keybindings.json file content.
 * Creates a fully valid JSON file with all default bindings that users can customize.
 */
// 过滤函数：剔除不可重绑的保留快捷键，并丢弃绑定为空的上下文块。
export function generateKeybindingsTemplate(): string {
  // Filter out reserved shortcuts that cannot be rebound
  const bindings = filterReservedShortcuts(DEFAULT_BINDINGS)

  // Format as object wrapper with bindings array
  const config = {
    $schema: 'https://www.schemastore.org/claude-code-keybindings.json',
    $docs: 'https://code.claude.com/docs/en/keybindings',
    bindings,
  }

  return jsonStringify(config, null, 2) + '\n'
}
// 导出模板生成器：过滤保留键后包成带 schema 链接的 JSON 配置并补换行。
