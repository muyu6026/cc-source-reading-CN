import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionUpdate } from '../../types/permissions.js'
import { formatFileSize } from '../../utils/format.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from '../../utils/permissions/permissions.js'
import { isPreapprovedHost } from './preapproved.js'
import { DESCRIPTION, WEB_FETCH_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import {
  applyPromptToMarkdown,
  type FetchedContent,
  getURLMarkdownContent,
  isPreapprovedUrl,
  MAX_MARKDOWN_LENGTH,
} from './utils.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().describe('The URL to fetch content from'),
    prompt: z.string().describe('The prompt to run on the fetched content'),
  }),
)
// 输入两件套：url + prompt——本工具不是「把网页塞给主模型」，
// 而是「抓网页 → 转markdown → 让小模型按 prompt 提炼 → 只回提炼结果」。
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    bytes: z.number().describe('Size of the fetched content in bytes'),
    code: z.number().describe('HTTP response code'),
    codeText: z.string().describe('HTTP response code text'),
    result: z
      .string()
      .describe('Processed result from applying the prompt to the content'),
    durationMs: z
      .number()
      .describe('Time taken to fetch and process the content'),
    url: z.string().describe('The URL that was fetched'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
// 输出带抓取元数据：字节数、HTTP 状态、耗时、最终 URL。result 是提炼后的文本。

export type Output = z.infer<OutputSchema>

function webFetchToolInputToPermissionRuleContent(input: {
  [k: string]: unknown
}): string {
  try {
    const parsedInput = WebFetchTool.inputSchema.safeParse(input)
    if (!parsedInput.success) {
      return `input:${input.toString()}`
    }
    const { url } = parsedInput.data
    const hostname = new URL(url).hostname
    return `domain:${hostname}`
  } catch {
    return `input:${input.toString()}`
  }
}
// 权限规则的内容键：把输入解析出 hostname，映射成 domain:<host> 规则；
// 解析失败退回 input:<原始串>（规则匹配永远有键可查）。

export const WebFetchTool = buildTool({
  name: WEB_FETCH_TOOL_NAME,
  searchHint: 'fetch and extract content from a URL',
  // 100K chars - tool result persistence threshold
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    const { url } = input as { url: string }
    try {
      const hostname = new URL(url).hostname
      return `Claude wants to fetch content from ${hostname}`
    } catch {
      return `Claude wants to fetch content from this URL`
    }
  },
// description 按 URL 动态生成——审批弹窗里显示「要从哪个域抓取」。
  userFacingName() {
    return 'Fetch'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Fetching ${summary}` : 'Fetching web page'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.prompt ? `${input.url}: ${input.prompt}` : input.url
  },
// 自动分类器输入：url + prompt（有 prompt 才拼）。
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    const permissionContext = appState.toolPermissionContext

    // Check if the hostname is in the preapproved list
    try {
      const { url } = input as { url: string }
      const parsedUrl = new URL(url)
      if (isPreapprovedHost(parsedUrl.hostname, parsedUrl.pathname)) {
        return {
          behavior: 'allow',
          updatedInput: input,
          decisionReason: { type: 'other', reason: 'Preapproved host' },
        }
      }
    } catch {
      // If URL parsing fails, continue with normal permission checks
    }
// 权限判定第一关：预批准清单（preapproved.ts）直接放行，
// 附 decisionReason=Preapproved host。URL 解析失败则落入常规检查。

    // Check for a rule specific to the tool input (matching hostname)
    const ruleContent = webFetchToolInputToPermissionRuleContent(input)

    const denyRule = getRuleByContentsForTool(
      permissionContext,
      WebFetchTool,
      'deny',
    ).get(ruleContent)
    if (denyRule) {
      return {
        behavior: 'deny',
        message: `${WebFetchTool.name} denied access to ${ruleContent}.`,
        decisionReason: {
          type: 'rule',
          rule: denyRule,
        },
      }
    }
// deny 规则命中：直接拒绝并说明被拒的域。

    const askRule = getRuleByContentsForTool(
      permissionContext,
      WebFetchTool,
      'ask',
    ).get(ruleContent)
    if (askRule) {
      return {
        behavior: 'ask',
        message: `Claude requested permissions to use ${WebFetchTool.name}, but you haven't granted it yet.`,
        decisionReason: {
          type: 'rule',
          rule: askRule,
        },
        suggestions: buildSuggestions(ruleContent),
      }
    }
// ask 规则命中：弹审批并附一键放行建议（buildSuggestions）。

    const allowRule = getRuleByContentsForTool(
      permissionContext,
      WebFetchTool,
      'allow',
    ).get(ruleContent)
    if (allowRule) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'rule',
          rule: allowRule,
        },
      }
    }
// allow 规则命中：静默放行。

    return {
      behavior: 'ask',
      message: `Claude requested permissions to use ${WebFetchTool.name}, but you haven't granted it yet.`,
      suggestions: buildSuggestions(ruleContent),
    }
// 无规则兜底：默认 ask + 建议。顺序严格为 预批准→deny→ask→allow→默认 ask，
// deny 永远优先于 allow。
  },
  async prompt(_options) {
    // Always include the auth warning regardless of whether ToolSearch is
    // currently in the tools list. Conditionally toggling this prefix based
    // on ToolSearch availability caused the tool description to flicker
    // between SDK query() calls (when ToolSearch enablement varies due to
    // MCP tool count thresholds), invalidating the Anthropic API prompt
    // cache on each toggle — two consecutive cache misses per flicker event.
// prompt() 顶部的认证警告必须无条件携带：曾按 ToolSearch 是否在工具列表里
// 动态增删这段前缀，结果 SDK query() 调用间描述来回抖动
// （ToolSearch 启用与否随 MCP 工具数阈值变化），每次抖动打爆两次 prompt cache——
// Anthropic API 的缓存键包含工具描述。这是「缓存键里有什么就别动态改什么」的实例。
    return `IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, look for a specialized MCP tool that provides authenticated access.
${DESCRIPTION}`
// 警告正文：认证/私有 URL（Google Docs、Confluence、Jira、GitHub）必挂，
// 应改用对应的 MCP 工具。
  },
  async validateInput(input) {
    const { url } = input
    try {
      new URL(url)
    } catch {
      return {
        result: false,
        message: `Error: Invalid URL "${url}". The URL provided could not be parsed.`,
        meta: { reason: 'invalid_url' },
        errorCode: 1,
      }
    }
    return { result: true }
// validateInput：URL 解析失败报错误码 1（zod 的 .url() 已拦一轮，这里是双保险）。
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(
    { url, prompt },
    { abortController, options: { isNonInteractiveSession } },
  ) {
    const start = Date.now()

    const response = await getURLMarkdownContent(url, abortController)

// call 主流程：抓取 → 跨域重定向转述 / 正常内容 → 预批准且是 markdown 且不超长
// 则跳过 Haiku 直接返回原文 → 否则 applyPromptToMarkdown 提炼。
    // Check if we got a redirect to a different host
    if ('type' in response && response.type === 'redirect') {
      const statusText =
        response.statusCode === 301
          ? 'Moved Permanently'
          : response.statusCode === 308
            ? 'Permanent Redirect'
            : response.statusCode === 307
              ? 'Temporary Redirect'
              : 'Found'

      const message = `REDIRECT DETECTED: The URL redirects to a different host.

Original URL: ${response.originalUrl}
Redirect URL: ${response.redirectUrl}
Status: ${response.statusCode} ${statusText}

To complete your request, I need to fetch content from the redirected URL. Please use WebFetch again with these parameters:
- url: "${response.redirectUrl}"
- prompt: "${prompt}"`

      const output: Output = {
        bytes: Buffer.byteLength(message),
        code: response.statusCode,
        codeText: statusText,
        result: message,
        durationMs: Date.now() - start,
        url,
      }

      return {
        data: output,
      }
    }
// 跨域重定向不自动跟：把原始/重定向 URL 与状态码拼成结构化消息返回，
// 并明确指示模型「用新 URL 再调一次 WebFetch」——把是否跟随的决定权留给审批层。

    const {
      content,
      bytes,
      code,
      codeText,
      contentType,
      persistedPath,
      persistedSize,
    } = response as FetchedContent

    const isPreapproved = isPreapprovedUrl(url)

    let result: string
    if (
      isPreapproved &&
      contentType.includes('text/markdown') &&
      content.length < MAX_MARKDOWN_LENGTH
    ) {
      result = content
// 预批准域 + text/markdown + 不超 10 万字符 → 跳过小模型直接用原文
// （预批准的是文档站，内容就是给模型读的，二次提炼反而丢细节）。
    } else {
      result = await applyPromptToMarkdown(
        prompt,
        content,
        abortController.signal,
        isNonInteractiveSession,
        isPreapproved,
      )
// 常规路径：applyPromptToMarkdown 让 Haiku 按 prompt 提炼。
    }

    // Binary content (PDFs, etc.) was additionally saved to disk with a
    // mime-derived extension. Note it so Claude can inspect the raw file
    // if the Haiku summary above isn't enough.
    if (persistedPath) {
      result += `\n\n[Binary content (${contentType}, ${formatFileSize(persistedSize ?? bytes)}) also saved to ${persistedPath}]`
    }
// 二进制内容已落盘的：在结果尾部补一句「原始文件存在哪」，
// Haiku 摘要不够用时模型可以自己去读文件。

    const output: Output = {
      bytes,
      code,
      codeText,
      result,
      durationMs: Date.now() - start,
      url,
    }

    return {
      data: output,
    }
  },
  mapToolResultToToolResultBlockParam({ result }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: result,
    }
  },
// 工具结果块就是 result 文本本体。
} satisfies ToolDef<InputSchema, Output>)

function buildSuggestions(ruleContent: string): PermissionUpdate[] {
  return [
    {
      type: 'addRules',
      destination: 'localSettings',
      rules: [{ toolName: WEB_FETCH_TOOL_NAME, ruleContent }],
      behavior: 'allow',
    },
  ]
}
// buildSuggestions：ask 时附「把 domain:<host> 加进 localSettings 放行」的
// 一键建议——用户点一下，下次同域不再弹窗。
