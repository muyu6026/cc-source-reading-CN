// 注：本文件把设置文件的 Zod 校验错误翻译成人类可读的提示：识别各类 Zod v4 问题、构造字段路径、给出修复建议与文档链接，并能在整文件校验前先过滤掉非法权限规则。
import type { ConfigScope } from 'src/services/mcp/types.js'
import type { ZodError, ZodIssue } from 'zod/v4'
import { jsonParse } from '../slowOperations.js'
import { plural } from '../stringUtils.js'
import { validatePermissionRule } from './permissionValidation.js'
import { generateSettingsJSONSchema } from './schemaOutput.js'
import type { SettingsJson } from './types.js'
import { SettingsSchema } from './types.js'
import { getValidationTip } from './validationTips.js'

/**
 * Helper type guards for specific Zod v4 issue types
 * In v4, issue types have different structures than v3
 */
// 注：isInvalidTypeIssue 等四个小函数是 Zod v4 各类 issue 的类型守卫，用于在后续分支里安全读取 expected/values/keys/minimum 等字段。
function isInvalidTypeIssue(issue: ZodIssue): issue is ZodIssue & {
  code: 'invalid_type'
  expected: string
  input: unknown
} {
  return issue.code === 'invalid_type'
}

function isInvalidValueIssue(issue: ZodIssue): issue is ZodIssue & {
  code: 'invalid_value'
  values: unknown[]
  input: unknown
} {
  return issue.code === 'invalid_value'
}

function isUnrecognizedKeysIssue(
  issue: ZodIssue,
): issue is ZodIssue & { code: 'unrecognized_keys'; keys: string[] } {
  return issue.code === 'unrecognized_keys'
}

function isTooSmallIssue(issue: ZodIssue): issue is ZodIssue & {
  code: 'too_small'
  minimum: number | bigint
  origin: string
} {
  return issue.code === 'too_small'
}

// 注：FieldPath 用点号路径表示字段位置（如 permissions.defaultMode），ValidationError 是一条校验错误的完整结构。
/** Field path in dot notation (e.g., "permissions.defaultMode", "env.DEBUG") */
export type FieldPath = string

// 注：ValidationError 含文件路径、字段路径、可读消息、期望值、非法值、修复建议、文档链接，以及 MCP 专属的作用域与严重度元数据。
export type ValidationError = {
  /** Relative file path */
  file?: string
  /** Field path in dot notation */
  path: FieldPath
  /** Human-readable error message */
  message: string
  /** Expected value or type */
  expected?: string
  /** The actual invalid value that was provided */
  invalidValue?: unknown
  /** Suggestion for fixing the error */
  suggestion?: string
  /** Link to relevant documentation */
  docLink?: string
  /** MCP-specific metadata - only present for MCP configuration errors */
  mcpErrorMetadata?: {
    /** Which configuration scope this error came from */
    scope: ConfigScope
    /** The server name if error is specific to a server */
    serverName?: string
    /** Severity of the error */
    severity?: 'fatal' | 'warning'
  }
}

export type SettingsWithErrors = {
  settings: SettingsJson
  errors: ValidationError[]
}

/**
 * Format a Zod validation error into human-readable validation errors
 */
/**
 * Get the type string for an unknown value (for error messages)
 */
// 注：getReceivedType 把未知值归约成类型名（null/undefined/array/typeof 结果），用于错误文案里说明「实际收到什么」。
function getReceivedType(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function extractReceivedFromMessage(msg: string): string | undefined {
  const match = msg.match(/received (\w+)/)
  return match ? match[1] : undefined
}

// 注：formatZodError 把 ZodError 的每条 issue 映射成 ValidationError，按类型拼出「期望 X 但收到 Y」「未识别字段」「数值不得小于 N」等可读消息。
export function formatZodError(
  error: ZodError,
  filePath: string,
): ValidationError[] {
  return error.issues.map((issue): ValidationError => {
    const path = issue.path.map(String).join('.')
    let message = issue.message
    let expected: string | undefined

    let enumValues: string[] | undefined
    let expectedValue: string | undefined
    let receivedValue: unknown
    let invalidValue: unknown

    if (isInvalidValueIssue(issue)) {
      enumValues = issue.values.map(v => String(v))
      expectedValue = enumValues.join(' | ')
      receivedValue = undefined
      invalidValue = undefined
    } else if (isInvalidTypeIssue(issue)) {
      expectedValue = issue.expected
      const receivedType = extractReceivedFromMessage(issue.message)
      receivedValue = receivedType ?? getReceivedType(issue.input)
      invalidValue = receivedType ?? getReceivedType(issue.input)
    } else if (isTooSmallIssue(issue)) {
      expectedValue = String(issue.minimum)
    } else if (issue.code === 'custom' && 'params' in issue) {
      const params = issue.params as { received?: unknown }
      receivedValue = params.received
      invalidValue = receivedValue
    }

    const tip = getValidationTip({
      path,
      code: issue.code,
      expected: expectedValue,
      received: receivedValue,
      enumValues,
      message: issue.message,
      value: receivedValue,
    })

    if (isInvalidValueIssue(issue)) {
      expected = enumValues?.map(v => `"${v}"`).join(', ')
      message = `Invalid value. Expected one of: ${expected}`
    } else if (isInvalidTypeIssue(issue)) {
      const receivedType =
        extractReceivedFromMessage(issue.message) ??
        getReceivedType(issue.input)
      if (
        issue.expected === 'object' &&
        receivedType === 'null' &&
        path === ''
      ) {
        message = 'Invalid or malformed JSON'
      } else {
        message = `Expected ${issue.expected}, but received ${receivedType}`
      }
    } else if (isUnrecognizedKeysIssue(issue)) {
      const keys = issue.keys.join(', ')
      message = `Unrecognized ${plural(issue.keys.length, 'field')}: ${keys}`
    } else if (isTooSmallIssue(issue)) {
      message = `Number must be greater than or equal to ${issue.minimum}`
      expected = String(issue.minimum)
    }

    return {
      file: filePath,
      path,
      message,
      expected,
      invalidValue,
      suggestion: tip?.suggestion,
      docLink: tip?.docLink,
    }
  })
}

/**
 * Validates that settings file content conforms to the SettingsSchema.
 * This is used during file edits to ensure the resulting file is valid.
 */
// 注：validateSettingsFileContent 在编辑设置时做整文件校验：先解析 JSON，再用严格模式对照 SettingsSchema，成功返回 isValid，失败给出错误与完整 schema 供参考。
export function validateSettingsFileContent(content: string):
  | {
      isValid: true
    }
  | {
      isValid: false
      error: string
      fullSchema: string
    } {
  try {
    // Parse the JSON first
    const jsonData = jsonParse(content)

    // Validate against SettingsSchema in strict mode
    const result = SettingsSchema().strict().safeParse(jsonData)

    if (result.success) {
      return { isValid: true }
    }

    // Format the validation error in a helpful way
    const errors = formatZodError(result.error, 'settings')
    const errorMessage =
      'Settings validation failed:\n' +
      errors.map(err => `- ${err.path}: ${err.message}`).join('\n')

    return {
      isValid: false,
      error: errorMessage,
      fullSchema: generateSettingsJSONSchema(),
    }
  } catch (parseError) {
    return {
      isValid: false,
      error: `Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parsing error'}`,
      fullSchema: generateSettingsJSONSchema(),
    }
  }
}

/**
 * Filters invalid permission rules from raw parsed JSON data before schema validation.
 * This prevents one bad rule from poisoning the entire settings file.
 * Returns warnings for each filtered rule.
 */
// 注：filterInvalidPermissionRules 在 schema 校验前先剔除非法权限规则（非字符串或不符合语法的），逐条给出告警而不让单条坏规则拖垮整份文件。
export function filterInvalidPermissionRules(
  data: unknown,
  filePath: string,
): ValidationError[] {
  if (!data || typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  if (!obj.permissions || typeof obj.permissions !== 'object') return []
  const perms = obj.permissions as Record<string, unknown>

  const warnings: ValidationError[] = []
  for (const key of ['allow', 'deny', 'ask']) {
    const rules = perms[key]
    if (!Array.isArray(rules)) continue

    perms[key] = rules.filter(rule => {
      if (typeof rule !== 'string') {
        warnings.push({
          file: filePath,
          path: `permissions.${key}`,
          message: `Non-string value in ${key} array was removed`,
          invalidValue: rule,
        })
        return false
      }
      const result = validatePermissionRule(rule)
      if (!result.valid) {
        let message = `Invalid permission rule "${rule}" was skipped`
        if (result.error) message += `: ${result.error}`
        if (result.suggestion) message += `. ${result.suggestion}`
        warnings.push({
          file: filePath,
          path: `permissions.${key}`,
          message,
          invalidValue: rule,
        })
        return false
      }
      return true
    })
  }
  return warnings
}
