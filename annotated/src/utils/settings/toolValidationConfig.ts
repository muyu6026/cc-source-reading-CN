/**
 * Tool validation configuration
 *
 * Most tools need NO configuration - basic validation works automatically.
 * Only add your tool here if it has special pattern requirements.
 */

export type ToolValidationConfig = {
// 定义工具校验配置类型。三类字段：filePatternTools 接受文件通配符（如 *.ts、src/**）；bashPrefixTools 接受星号任意位置与旧式冒号前缀；customValidation 为个别工具提供定制校验函数。
  /** Tools that accept file glob patterns (e.g., *.ts, src/**) */
  filePatternTools: string[]

  /** Tools that accept bash wildcard patterns (* anywhere) and legacy :* prefix syntax */
  bashPrefixTools: string[]

  /** Custom validation rules for specific tools */
  customValidation: {
    [toolName: string]: (content: string) => {
      valid: boolean
      error?: string
      suggestion?: string
      examples?: string[]
    }
  }
}

export const TOOL_VALIDATION_CONFIG: ToolValidationConfig = {
// 导出唯一配置实例。多数工具无需特殊配置，这里只登记少数有格式要求的工具。
  // File pattern tools (accept *.ts, src/**, etc.)
  filePatternTools: [
    'Read',
    'Write',
    'Edit',
    'Glob',
    'NotebookRead',
    'NotebookEdit',
  ],

  // Bash wildcard tools (accept * anywhere, and legacy command:* syntax)
  bashPrefixTools: ['Bash'],

  // Custom validation (only if needed)
  customValidation: {
    // WebSearch doesn't support wildcards or complex patterns
    WebSearch: content => {
// WebSearch 的定制校验：内容里出现星号或问号即判非法，提示改用精确检索词。
      if (content.includes('*') || content.includes('?')) {
        return {
          valid: false,
          error: 'WebSearch does not support wildcards',
          suggestion: 'Use exact search terms without * or ?',
          examples: ['WebSearch(claude ai)', 'WebSearch(typescript tutorial)'],
        }
      }
      return { valid: true }
    },

    // WebFetch uses domain: prefix for hostname-based permissions
    WebFetch: content => {
// WebFetch 的定制校验：必须使用 domain:主机名 形式，URL 或裸主机名一律拒绝。
      // Check if it's trying to use a URL format
      if (content.includes('://') || content.startsWith('http')) {
        return {
          valid: false,
          error: 'WebFetch permissions use domain format, not URLs',
          suggestion: 'Use "domain:hostname" format',
          examples: [
            'WebFetch(domain:example.com)',
            'WebFetch(domain:github.com)',
          ],
        }
      }

      // Must start with domain: prefix
      if (!content.startsWith('domain:')) {
        return {
          valid: false,
          error: 'WebFetch permissions must use "domain:" prefix',
          suggestion: 'Use "domain:hostname" format',
          examples: [
            'WebFetch(domain:example.com)',
            'WebFetch(domain:*.google.com)',
          ],
        }
      }

      // Allow wildcards in domain patterns
      // Valid: domain:*.example.com, domain:example.*, etc.
      return { valid: true }
    },
  },
}

// Helper to check if a tool uses file patterns
export function isFilePatternTool(toolName: string): boolean {
// 判断某工具是否按文件通配符解析参数。
  return TOOL_VALIDATION_CONFIG.filePatternTools.includes(toolName)
}

// Helper to check if a tool uses bash prefix patterns
export function isBashPrefixTool(toolName: string): boolean {
// 判断某工具是否按 Bash 通配符（星号任意位置）解析参数。
  return TOOL_VALIDATION_CONFIG.bashPrefixTools.includes(toolName)
}

// Helper to get custom validation for a tool
export function getCustomValidation(toolName: string) {
// 按工具名取出对应的定制校验函数；可能不存在，调用方需自行判空。
  return TOOL_VALIDATION_CONFIG.customValidation[toolName]
}
