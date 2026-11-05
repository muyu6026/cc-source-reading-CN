import { plural } from '../utils/stringUtils.js'
import { chordToString, parseChord, parseKeystroke } from './parser.js'
import {
  getReservedShortcuts,
  normalizeKeyForComparison,
} from './reservedShortcuts.js'
import type {
  KeybindingBlock,
  KeybindingContextName,
  ParsedBinding,
} from './types.js'

/**
 * Types of validation issues that can occur with keybindings.
 */
// 五类问题分开命名：解析失败、重复、保留冲突、上下文未知、动作非法
export type KeybindingWarningType =
  | 'parse_error'
  | 'duplicate'
  | 'reserved'
  | 'invalid_context'
  | 'invalid_action'

/**
 * A warning or error about a keybinding configuration issue.
 */
// 告警结构带上定位字段：键、上下文、动作、建议，缺一个用户就不知道该改哪行
export type KeybindingWarning = {
  type: KeybindingWarningType
  severity: 'error' | 'warning'
  message: string
  key?: string
  context?: string
  action?: string
  suggestion?: string
}

/**
 * Type guard to check if an object is a valid KeybindingBlock.
 */
// 类型守卫只查两个必填字段，不深挖内部结构，深层问题留给逐项校验去发现
function isKeybindingBlock(obj: unknown): obj is KeybindingBlock {
  if (typeof obj !== 'object' || obj === null) return false
  const b = obj as Record<string, unknown>
  return (
    typeof b.context === 'string' &&
    typeof b.bindings === 'object' &&
    b.bindings !== null
  )
}

/**
 * Type guard to check if an array contains only valid KeybindingBlocks.
 */
function isKeybindingBlockArray(arr: unknown): arr is KeybindingBlock[] {
  return Array.isArray(arr) && arr.every(isKeybindingBlock)
}

/**
 * Valid context names for keybindings.
 * Must match KeybindingContextName in types.ts
 */
// 合法上下文清单必须与类型定义手工同步，这是唯一一处靠人守的契约
const VALID_CONTEXTS: KeybindingContextName[] = [
  'Global',
  'Chat',
  'Autocomplete',
  'Confirmation',
  'Help',
  'Transcript',
  'HistorySearch',
  'Task',
  'ThemePicker',
  'Settings',
  'Tabs',
  'Attachments',
  'Footer',
  'MessageSelector',
  'DiffDialog',
  'ModelPicker',
  'Select',
  'Plugin',
]

/**
 * Type guard to check if a string is a valid context name.
 */
function isValidContext(value: string): value is KeybindingContextName {
  return (VALID_CONTEXTS as readonly string[]).includes(value)
}

/**
 * Validate a single keystroke string and return any parse errors.
 */
// 单键校验先切加号再看每段是否为空：连写两个加号是最常见的输入错误
function validateKeystroke(keystroke: string): KeybindingWarning | null {
  const parts = keystroke.toLowerCase().split('+')

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) {
      return {
        type: 'parse_error',
        severity: 'error',
        message: `Empty key part in "${keystroke}"`,
        key: keystroke,
        suggestion: 'Remove extra "+" characters',
      }
    }
  }

  // Try to parse and see if it fails
// 解析结果五个字段全空说明这串根本解析不出来，而不是恰好绑了个空键
  const parsed = parseKeystroke(keystroke)
  if (
    !parsed.key &&
    !parsed.ctrl &&
    !parsed.alt &&
    !parsed.shift &&
    !parsed.meta
  ) {
    return {
      type: 'parse_error',
      severity: 'error',
      message: `Could not parse keystroke "${keystroke}"`,
      key: keystroke,
    }
  }

  return null
}

/**
 * Validate a keybinding block from user config.
 */
// 整块校验：先确认是对象，再依次查上下文与绑定表，缺任一就直接返回
function validateBlock(
  block: unknown,
  blockIndex: number,
): KeybindingWarning[] {
  const warnings: KeybindingWarning[] = []

  if (typeof block !== 'object' || block === null) {
    warnings.push({
      type: 'parse_error',
      severity: 'error',
      message: `Keybinding block ${blockIndex + 1} is not an object`,
    })
    return warnings
  }

  const b = block as Record<string, unknown>

  // Validate context - extract to narrowed variable for type safety
// 上下文先取到局部变量，后面几处告警都要带上它做定位
  const rawContext = b.context
  let contextName: string | undefined
  if (typeof rawContext !== 'string') {
    warnings.push({
      type: 'parse_error',
      severity: 'error',
      message: `Keybinding block ${blockIndex + 1} missing "context" field`,
    })
  } else if (!isValidContext(rawContext)) {
    warnings.push({
      type: 'invalid_context',
      severity: 'error',
      message: `Unknown context "${rawContext}"`,
      context: rawContext,
      suggestion: `Valid contexts: ${VALID_CONTEXTS.join(', ')}`,
    })
  } else {
    contextName = rawContext
  }

  // Validate bindings
  if (typeof b.bindings !== 'object' || b.bindings === null) {
    warnings.push({
      type: 'parse_error',
      severity: 'error',
      message: `Keybinding block ${blockIndex + 1} missing "bindings" field`,
    })
    return warnings
  }

  const bindings = b.bindings as Record<string, unknown>
// 逐条走绑定表：键与动作分别校验，键的语法错误也带上上下文方便定位
  for (const [key, action] of Object.entries(bindings)) {
    // Validate key syntax
    const keyError = validateKeystroke(key)
    if (keyError) {
      keyError.context = contextName
      warnings.push(keyError)
    }

    // Validate action
// 动作只允许字符串或空值，空值是有意义的解绑语义而不是错误
    if (action !== null && typeof action !== 'string') {
      warnings.push({
        type: 'invalid_action',
        severity: 'error',
        message: `Invalid action for "${key}": must be a string or null`,
        key,
        context: contextName,
      })
    } else if (typeof action === 'string' && action.startsWith('command:')) {
// 命令类绑定单独放宽：只允许字母数字、冒号、连字符、下划线，防止注入路径片段
      // Validate command binding format
      if (!/^command:[a-zA-Z0-9:\-_]+$/.test(action)) {
        warnings.push({
          type: 'invalid_action',
          severity: 'warning',
          message: `Invalid command binding "${action}" for "${key}": command name may only contain alphanumeric characters, colons, hyphens, and underscores`,
          key,
          context: contextName,
          action,
        })
      }
      // Command bindings must be in Chat context
// 命令只能在对话上下文里生效，放到别的上下文即使写了也永远不会被触发
      if (contextName && contextName !== 'Chat') {
        warnings.push({
          type: 'invalid_action',
          severity: 'warning',
          message: `Command binding "${action}" must be in "Chat" context, not "${contextName}"`,
          key,
          context: contextName,
          action,
          suggestion: 'Move this binding to a block with "context": "Chat"',
        })
      }
    } else if (action === 'voice:pushToTalk') {
// 按住说话靠系统自动重复：裸字母在预热期会把字符打进输入框，必须提示换键
      // Hold detection needs OS auto-repeat. Bare letters print into the
      // input during warmup and the activation strip is best-effort —
      // space (default) or a modifier combo like meta+k avoid that.
// 只看组合键的第一个键：带修饰键就不算裸字母，可以放行
      const ks = parseChord(key)[0]
      if (
        ks &&
        !ks.ctrl &&
        !ks.alt &&
        !ks.shift &&
        !ks.meta &&
        !ks.super &&
        /^[a-z]$/.test(ks.key)
      ) {
        warnings.push({
          type: 'invalid_action',
          severity: 'warning',
          message: `Binding "${key}" to voice:pushToTalk prints into the input during warmup; use space or a modifier combo like meta+k`,
          key,
          context: contextName,
          action,
        })
      }
    }
  }

  return warnings
}

/**
 * Detect duplicate keys within the same bindings block in a JSON string.
 * JSON.parse silently uses the last value for duplicate keys,
 * so we need to check the raw string to warn users.
 *
 * Only warns about duplicates within the same context's bindings object.
 * Duplicates across different contexts are allowed (e.g., "enter" in Chat
 * and "enter" in Confirmation).
 */
// 重复键必须回到原始字符串去查：解析后的对象已经丢了重复信息
export function checkDuplicateKeysInJson(
  jsonString: string,
): KeybindingWarning[] {
  const warnings: KeybindingWarning[] = []

  // Find each "bindings" block and check for duplicates within it
  // Pattern: "bindings" : { ... }
// 匹配绑定块的正则要允许值里出现嵌套对象，否则遇到多层结构就漏检
  const bindingsBlockPattern =
    /"bindings"\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g

  let blockMatch
  while ((blockMatch = bindingsBlockPattern.exec(jsonString)) !== null) {
    const blockContent = blockMatch[1]
    if (!blockContent) continue

    // Find the context for this block by looking backwards
// 上下文不在块的内部而在块之前，所以往前找最近的一处声明
    const textBeforeBlock = jsonString.slice(0, blockMatch.index)
    const contextMatch = textBeforeBlock.match(
      /"context"\s*:\s*"([^"]+)"[^{]*$/,
    )
    const context = contextMatch?.[1] ?? 'unknown'

    // Find all keys within this bindings block
// 键名统计只看冒号前的引号字符串，够用且不会误伤值里的同名文本
    const keyPattern = /"([^"]+)"\s*:/g
    const keysByName = new Map<string, number>()

    let keyMatch
    while ((keyMatch = keyPattern.exec(blockContent)) !== null) {
      const key = keyMatch[1]
      if (!key) continue

      const count = (keysByName.get(key) ?? 0) + 1
      keysByName.set(key, count)

// 只在第二次出现时告警：一次重复只报一条，报在第一次出现处没有意义
      if (count === 2) {
        // Only warn on the second occurrence
        warnings.push({
          type: 'duplicate',
          severity: 'warning',
          message: `Duplicate key "${key}" in ${context} bindings`,
          key,
          context,
          suggestion: `This key appears multiple times in the same context. JSON uses the last value, earlier values are ignored.`,
        })
      }
    }
  }

  return warnings
}

/**
 * Validate user keybinding config and return all warnings.
 */
// 整份配置的入口校验：顶层必须是数组，不是就直接返回一条结构错误
export function validateUserConfig(userBlocks: unknown): KeybindingWarning[] {
  const warnings: KeybindingWarning[] = []

  if (!Array.isArray(userBlocks)) {
    warnings.push({
      type: 'parse_error',
      severity: 'error',
      message: 'keybindings.json must contain an array',
      suggestion: 'Wrap your bindings in [ ]',
    })
    return warnings
  }

  for (let i = 0; i < userBlocks.length; i++) {
    warnings.push(...validateBlock(userBlocks[i], i))
  }

  return warnings
}

/**
 * Check for duplicate bindings within the same context.
 * Only checks user bindings (not default + user merged).
 */
// 跨块查重：同一上下文内后写的会覆盖先写的，所以按上下文各建一张表
export function checkDuplicates(
  blocks: KeybindingBlock[],
): KeybindingWarning[] {
  const warnings: KeybindingWarning[] = []
  const seenByContext = new Map<string, Map<string, string>>()

  for (const block of blocks) {
    const contextMap =
      seenByContext.get(block.context) ?? new Map<string, string>()
    seenByContext.set(block.context, contextMap)

    for (const [key, action] of Object.entries(block.bindings)) {
      const normalizedKey = normalizeKeyForComparison(key)
      const existingAction = contextMap.get(normalizedKey)

// 只有动作不同才算冲突：同一个动作绑两次是冗余但无害，不必打扰用户
      if (existingAction && existingAction !== action) {
        warnings.push({
          type: 'duplicate',
          severity: 'warning',
          message: `Duplicate binding "${key}" in ${block.context} context`,
          key,
          context: block.context,
          action: action ?? 'null (unbind)',
          suggestion: `Previously bound to "${existingAction}". Only the last binding will be used.`,
        })
      }

// 无论是否告警都要记下这次的键，后面的块才能与它比对
      contextMap.set(normalizedKey, action ?? 'null')
    }
  }

  return warnings
}

/**
 * Check for reserved shortcuts that may not work.
 */
// 保留快捷键检查：拿系统或终端已经占用的键去比对，命中就给出原因
export function checkReservedShortcuts(
  bindings: ParsedBinding[],
): KeybindingWarning[] {
  const warnings: KeybindingWarning[] = []
  const reserved = getReservedShortcuts()

// 比较前统一归一化，大小写与修饰键顺序都不该影响判定
  for (const binding of bindings) {
    const keyDisplay = chordToString(binding.chord)
    const normalizedKey = normalizeKeyForComparison(keyDisplay)

    // Check against reserved shortcuts
    for (const res of reserved) {
      if (normalizeKeyForComparison(res.key) === normalizedKey) {
        warnings.push({
          type: 'reserved',
          severity: res.severity,
          message: `"${keyDisplay}" may not work: ${res.reason}`,
          key: keyDisplay,
          context: binding.context,
          action: binding.action ?? undefined,
        })
      }
    }
  }

  return warnings
}

/**
 * Parse user blocks into bindings for validation.
 * This is separate from the main parser to avoid importing it.
 */
// 这里自己解析一遍用户键位而不是调主解析器，避免为一个校验引入整条依赖链
function getUserBindingsForValidation(
  userBlocks: KeybindingBlock[],
): ParsedBinding[] {
  const bindings: ParsedBinding[] = []
  for (const block of userBlocks) {
    for (const [key, action] of Object.entries(block.bindings)) {
      const chord = key.split(' ').map(k => parseKeystroke(k))
      bindings.push({
        chord,
        action,
        context: block.context,
      })
    }
  }
  return bindings
}

/**
 * Run all validations and return combined warnings.
 */
// 汇总入口：结构校验与两种查重都跑一遍，最后按类型加键加上下文去重
export function validateBindings(
  userBlocks: unknown,
  _parsedBindings: ParsedBinding[],
): KeybindingWarning[] {
  const warnings: KeybindingWarning[] = []

  // Validate user config structure
  warnings.push(...validateUserConfig(userBlocks))

  // Check for duplicates in user config
  if (isKeybindingBlockArray(userBlocks)) {
    warnings.push(...checkDuplicates(userBlocks))

    // Check for reserved/conflicting shortcuts - only check USER bindings
    const userBindings = getUserBindingsForValidation(userBlocks)
    warnings.push(...checkReservedShortcuts(userBindings))
  }

  // Deduplicate warnings (same key+context+type)
  const seen = new Set<string>()
// 去重键不含消息文本：同一处问题被两条路径报出来时只留第一条
  return warnings.filter(w => {
    const key = `${w.type}:${w.key}:${w.context}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Format a warning for display to the user.
 */
// 单条格式化：图标按严重度区分，建议另起一行缩进显示
export function formatWarning(warning: KeybindingWarning): string {
  const icon = warning.severity === 'error' ? '✗' : '⚠'
  let msg = `${icon} Keybinding ${warning.severity}: ${warning.message}`

  if (warning.suggestion) {
    msg += `\n  ${warning.suggestion}`
  }

  return msg
}

/**
 * Format multiple warnings for display.
 */
// 多条格式化：错误在前警告在后，两组之间空一行，数量为复数时词形正确
export function formatWarnings(warnings: KeybindingWarning[]): string {
  if (warnings.length === 0) return ''

  const errors = warnings.filter(w => w.severity === 'error')
  const warns = warnings.filter(w => w.severity === 'warning')

  const lines: string[] = []

  if (errors.length > 0) {
    lines.push(
      `Found ${errors.length} keybinding ${plural(errors.length, 'error')}:`,
    )
    for (const e of errors) {
      lines.push(formatWarning(e))
    }
  }

  if (warns.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(
      `Found ${warns.length} keybinding ${plural(warns.length, 'warning')}:`,
    )
    for (const w of warns) {
      lines.push(formatWarning(w))
    }
  }

  return lines.join('\n')
}
