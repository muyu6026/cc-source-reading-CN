import { feature } from 'bun:bundle'
import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { TASK_OUTPUT_TOOL_NAME } from '../../tools/TaskOutputTool/constants.js'
import { TASK_STOP_TOOL_NAME } from '../../tools/TaskStopTool/prompt.js'
import type { PermissionRuleValue } from './PermissionRule.js'

// Dead code elimination: ant-only tool names are conditionally required so
// their strings don't leak into external builds. Static imports always bundle.
/* eslint-disable @typescript-eslint/no-require-imports */
const BRIEF_TOOL_NAME: string | null =
  feature('KAIROS') || feature('KAIROS_BRIEF')
    ? (
        require('../../tools/BriefTool/prompt.js') as typeof import('../../tools/BriefTool/prompt.js')
      ).BRIEF_TOOL_NAME
    : null
/* eslint-enable @typescript-eslint/no-require-imports */
// BRIEF_TOOL_NAME 通过条件 require 获取 ANT 专属工具名，受 KAIROS 特性门控以避免泄漏到外部构建。

// Maps legacy tool names to their current canonical names.
// When a tool is renamed, add old → new here so permission rules,
// hooks, and persisted wire names resolve to the canonical name.
const LEGACY_TOOL_NAME_ALIASES: Record<string, string> = {
  Task: AGENT_TOOL_NAME,
  KillShell: TASK_STOP_TOOL_NAME,
  AgentOutputTool: TASK_OUTPUT_TOOL_NAME,
  BashOutputTool: TASK_OUTPUT_TOOL_NAME,
  ...((feature('KAIROS') || feature('KAIROS_BRIEF')) && BRIEF_TOOL_NAME
    ? { Brief: BRIEF_TOOL_NAME }
    : {}),
}
// LEGACY_TOOL_NAME_ALIASES 把旧工具名映射到当前规范名，工具改名后权限规则与 hook 仍能解析到正确名称。

export function normalizeLegacyToolName(name: string): string {
  return LEGACY_TOOL_NAME_ALIASES[name] ?? name
}
// normalizeLegacyToolName 收尾：查别名表，未命中则返回原名。

export function getLegacyToolNames(canonicalName: string): string[] {
  const result: string[] = []
  for (const [legacy, canonical] of Object.entries(LEGACY_TOOL_NAME_ALIASES)) {
    if (canonical === canonicalName) result.push(legacy)
  }
  return result
}
// getLegacyToolNames 收尾：反向查表，返回某规范名对应的所有历史旧名。

/**
 * Escapes special characters in rule content for safe storage in permission rules.
 * Permission rules use the format "Tool(content)", so parentheses in content must be escaped.
 *
 * Escaping order matters:
 * 1. Escape existing backslashes first (\ -> \\)
 * 2. Then escape parentheses (( -> \(, ) -> \))
 *
 * @example
 * escapeRuleContent('psycopg2.connect()') // => 'psycopg2.connect\\(\\)'
 * escapeRuleContent('echo "test\\nvalue"') // => 'echo "test\\\\nvalue"'
 */
export function escapeRuleContent(content: string): string {
  return content
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/\(/g, '\\(') // Escape opening parentheses
    .replace(/\)/g, '\\)') // Escape closing parentheses
}
// escapeRuleContent 收尾：转义顺序为先反斜杠后括号，确保规则内容在 `Tool(content)` 格式中安全存储。

/**
 * Unescapes special characters in rule content after parsing from permission rules.
 * This reverses the escaping done by escapeRuleContent.
 *
 * Unescaping order matters (reverse of escaping):
 * 1. Unescape parentheses first (\( -> (, \) -> ))
 * 2. Then unescape backslashes (\\ -> \)
 *
 * @example
 * unescapeRuleContent('psycopg2.connect\\(\\)') // => 'psycopg2.connect()'
 * unescapeRuleContent('echo "test\\\\nvalue"') // => 'echo "test\\nvalue"'
 */
export function unescapeRuleContent(content: string): string {
  return content
    .replace(/\\\(/g, '(') // Unescape opening parentheses
    .replace(/\\\)/g, ')') // Unescape closing parentheses
    .replace(/\\\\/g, '\\') // Unescape backslashes last
}
// unescapeRuleContent 收尾：按相反顺序（先括号后反斜杠）还原转义内容。

/**
 * Parses a permission rule string into its components.
 * Handles escaped parentheses in the content portion.
 *
 * Format: "ToolName" or "ToolName(content)"
 * Content may contain escaped parentheses: \( and \)
 *
 * @example
 * permissionRuleValueFromString('Bash') // => { toolName: 'Bash' }
 * permissionRuleValueFromString('Bash(npm install)') // => { toolName: 'Bash', ruleContent: 'npm install' }
 * permissionRuleValueFromString('Bash(python -c "print\\(1\\)")') // => { toolName: 'Bash', ruleContent: 'python -c "print(1)"' }
 */
// permissionRuleValueFromString 把 `ToolName` 或 `ToolName(content)` 字符串解析为工具名与可选内容，处理转义括号。
export function permissionRuleValueFromString(
  ruleString: string,
): PermissionRuleValue {
  // Find the first unescaped opening parenthesis
  const openParenIndex = findFirstUnescapedChar(ruleString, '(')
  if (openParenIndex === -1) {
    // No parenthesis found - this is just a tool name
    return { toolName: normalizeLegacyToolName(ruleString) }
  }

  // Find the last unescaped closing parenthesis
  const closeParenIndex = findLastUnescapedChar(ruleString, ')')
  if (closeParenIndex === -1 || closeParenIndex <= openParenIndex) {
    // No matching closing paren or malformed - treat as tool name
    return { toolName: normalizeLegacyToolName(ruleString) }
  }

  // Ensure the closing paren is at the end
  if (closeParenIndex !== ruleString.length - 1) {
    // Content after closing paren - treat as tool name
    return { toolName: normalizeLegacyToolName(ruleString) }
  }

  const toolName = ruleString.substring(0, openParenIndex)
  const rawContent = ruleString.substring(openParenIndex + 1, closeParenIndex)

  // Missing toolName (e.g., "(foo)") is malformed - treat whole string as tool name
  if (!toolName) {
    return { toolName: normalizeLegacyToolName(ruleString) }
  }

  // Empty content (e.g., "Bash()") or standalone wildcard (e.g., "Bash(*)")
  // should be treated as just the tool name (tool-wide rule)
  if (rawContent === '' || rawContent === '*') {
    return { toolName: normalizeLegacyToolName(toolName) }
  }

  // Unescape the content
  const ruleContent = unescapeRuleContent(rawContent)
  return { toolName: normalizeLegacyToolName(toolName), ruleContent }
}
// permissionRuleValueFromString 收尾：各种畸形（缺括号、缺工具名、尾随内容、空或通配）都安全回退为纯工具名。

/**
 * Converts a permission rule value to its string representation.
 * Escapes parentheses in the content to prevent parsing issues.
 *
 * @example
 * permissionRuleValueToString({ toolName: 'Bash' }) // => 'Bash'
 * permissionRuleValueToString({ toolName: 'Bash', ruleContent: 'npm install' }) // => 'Bash(npm install)'
 * permissionRuleValueToString({ toolName: 'Bash', ruleContent: 'python -c "print(1)"' }) // => 'Bash(python -c "print\\(1\\)")'
 */
// permissionRuleValueToString 把规则值序列化为字符串表示，对内容中的括号做转义。
export function permissionRuleValueToString(
  ruleValue: PermissionRuleValue,
): string {
  if (!ruleValue.ruleContent) {
    return ruleValue.toolName
  }
  const escapedContent = escapeRuleContent(ruleValue.ruleContent)
  return `${ruleValue.toolName}(${escapedContent})`
}
// permissionRuleValueToString 收尾：无内容时只返回工具名。

/**
 * Find the index of the first unescaped occurrence of a character.
 * A character is escaped if preceded by an odd number of backslashes.
 */
function findFirstUnescapedChar(str: string, char: string): number {
  for (let i = 0; i < str.length; i++) {
    if (str[i] === char) {
      // Count preceding backslashes
      let backslashCount = 0
      let j = i - 1
      while (j >= 0 && str[j] === '\\') {
        backslashCount++
        j--
      }
      // If even number of backslashes, the char is unescaped
      if (backslashCount % 2 === 0) {
        return i
      }
    }
  }
  return -1
}
// findFirstUnescapedChar 收尾：向前统计反斜杠个数，偶数为未转义，返回首个未转义字符下标。

/**
 * Find the index of the last unescaped occurrence of a character.
 * A character is escaped if preceded by an odd number of backslashes.
 */
function findLastUnescapedChar(str: string, char: string): number {
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] === char) {
      // Count preceding backslashes
      let backslashCount = 0
      let j = i - 1
      while (j >= 0 && str[j] === '\\') {
        backslashCount++
        j--
      }
      // If even number of backslashes, the char is unescaped
      if (backslashCount % 2 === 0) {
        return i
      }
    }
  }
  return -1
}
// findLastUnescapedChar 收尾：从末尾反向扫描，同样以反斜杠奇偶判定是否转义。
