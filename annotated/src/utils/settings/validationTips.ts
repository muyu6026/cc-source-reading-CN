import type { ZodIssueCode } from 'zod/v4'

// v4 ZodIssueCode is a value, not a type - use typeof to get the type
type ZodIssueCodeType = (typeof ZodIssueCode)[keyof typeof ZodIssueCode]
// 文件入口：基于 Zod 校验错误，提供人类可读的修复建议与文档链接。

export type ValidationTip = {
  suggestion?: string
  docLink?: string
}

export type TipContext = {
  path: string
  code: ZodIssueCodeType | string
  expected?: string
  received?: unknown
  enumValues?: string[]
  message?: string
  value?: unknown
}
// TipContext：校验错误的上下文，含路径、错误码、期望值等。

type TipMatcher = {
  matches: (context: TipContext) => boolean
  tip: ValidationTip
}
// TipMatcher：匹配函数与建议的组合。

const DOCUMENTATION_BASE = 'https://code.claude.com/docs/en'
// DOCUMENTATION_BASE：文档站基址。

const TIP_MATCHERS: TipMatcher[] = [
  {
    matches: (ctx): boolean =>
      ctx.path === 'permissions.defaultMode' && ctx.code === 'invalid_value',
    tip: {
      suggestion:
        'Valid modes: "acceptEdits" (ask before file changes), "plan" (analysis only), "bypassPermissions" (auto-accept all), or "default" (standard behavior)',
      docLink: `${DOCUMENTATION_BASE}/iam#permission-modes`,
    },
  },
  {
    matches: (ctx): boolean =>
      ctx.path === 'apiKeyHelper' && ctx.code === 'invalid_type',
    tip: {
      suggestion:
        'Provide a shell command that outputs your API key to stdout. The script should output only the API key. Example: "/bin/generate_temp_api_key.sh"',
    },
  },
  {
    matches: (ctx): boolean =>
      ctx.path === 'cleanupPeriodDays' &&
      ctx.code === 'too_small' &&
      ctx.expected === '0',
    tip: {
      suggestion:
        'Must be 0 or greater. Set a positive number for days to retain transcripts (default is 30). Setting 0 disables session persistence entirely: no transcripts are written and existing transcripts are deleted at startup.',
    },
// cleanupPeriodDays 校验提示：设为 0 会彻底关闭会话持久化。
  },
  {
    matches: (ctx): boolean =>
      ctx.path.startsWith('env.') && ctx.code === 'invalid_type',
    tip: {
      suggestion:
        'Environment variables must be strings. Wrap numbers and booleans in quotes. Example: "DEBUG": "true", "PORT": "3000"',
      docLink: `${DOCUMENTATION_BASE}/settings#environment-variables`,
    },
  },
  {
    matches: (ctx): boolean =>
      (ctx.path === 'permissions.allow' || ctx.path === 'permissions.deny') &&
      ctx.code === 'invalid_type' &&
      ctx.expected === 'array',
    tip: {
      suggestion:
        'Permission rules must be in an array. Format: ["Tool(specifier)"]. Examples: ["Bash(npm run build)", "Edit(docs/**)", "Read(~/.zshrc)"]. Use * for wildcards.',
    },
  },
  {
    matches: (ctx): boolean =>
      ctx.path.includes('hooks') && ctx.code === 'invalid_type',
    tip: {
      suggestion:
        // gh-31187 / CC-282: prior example showed {"matcher": {"tools": ["BashTool"]}}
        // — an object format that never existed in the schema (matcher is z.string(),
        // always has been). Users copied the tip's example and got the same validation
        // error again. See matchesPattern() in hooks.ts: matcher is exact-match,
        // pipe-separated ("Edit|Write"), or regex. Empty/"*" matches all.
        'Hooks use a matcher + hooks array. The matcher is a string: a tool name ("Bash"), pipe-separated list ("Edit|Write"), or empty to match all. Example: {"PostToolUse": [{"matcher": "Edit|Write", "hooks": [{"type": "command", "command": "echo Done"}]}]}',
    },
  },
// hooks 校验提示，纠正历史上错误的 matcher 对象写法。
  {
    matches: (ctx): boolean =>
      ctx.code === 'invalid_type' && ctx.expected === 'boolean',
    tip: {
      suggestion:
        'Use true or false without quotes. Example: "includeCoAuthoredBy": true',
    },
  },
  {
    matches: (ctx): boolean => ctx.code === 'unrecognized_keys',
    tip: {
      suggestion:
        'Check for typos or refer to the documentation for valid fields',
      docLink: `${DOCUMENTATION_BASE}/settings`,
    },
  },
  {
    matches: (ctx): boolean =>
      ctx.code === 'invalid_value' && ctx.enumValues !== undefined,
    tip: {
      suggestion: undefined,
    },
  },
  {
    matches: (ctx): boolean =>
      ctx.code === 'invalid_type' &&
      ctx.expected === 'object' &&
      ctx.received === null &&
      ctx.path === '',
    tip: {
      suggestion:
        'Check for missing commas, unmatched brackets, or trailing commas. Use a JSON validator to identify the exact syntax error.',
    },
  },
  {
    matches: (ctx): boolean =>
      ctx.path === 'permissions.additionalDirectories' &&
      ctx.code === 'invalid_type',
    tip: {
      suggestion:
        'Must be an array of directory paths. Example: ["~/projects", "/tmp/workspace"]. You can also use --add-dir flag or /add-dir command',
      docLink: `${DOCUMENTATION_BASE}/iam#working-directories`,
    },
  },
]
// TIP_MATCHERS：针对各 settings 字段的匹配规则表。

const PATH_DOC_LINKS: Record<string, string> = {
  permissions: `${DOCUMENTATION_BASE}/iam#configuring-permissions`,
  env: `${DOCUMENTATION_BASE}/settings#environment-variables`,
  hooks: `${DOCUMENTATION_BASE}/hooks`,
}
// PATH_DOC_LINKS：按路径前缀补齐文档链接。

export function getValidationTip(context: TipContext): ValidationTip | null {
  const matcher = TIP_MATCHERS.find(m => m.matches(context))

  if (!matcher) return null

  const tip: ValidationTip = { ...matcher.tip }

  if (
    context.code === 'invalid_value' &&
    context.enumValues &&
    !tip.suggestion
  ) {
    tip.suggestion = `Valid values: ${context.enumValues.map(v => `"${v}"`).join(', ')}`
  }
// 枚举校验错误时拼出合法取值列表作为建议。

  // Add documentation link based on path prefix
  if (!tip.docLink && context.path) {
    const pathPrefix = context.path.split('.')[0]
    if (pathPrefix) {
      tip.docLink = PATH_DOC_LINKS[pathPrefix]
    }
  }

  return tip
}
// getValidationTip：查找匹配规则，组合建议与文档链接后返回。
