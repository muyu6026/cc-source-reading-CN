export const WEB_FETCH_TOOL_NAME = 'WebFetch'

// 工具注册名 WebFetch。
export const DESCRIPTION = `
- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
`
// DESCRIPTION（发给模型的说明）：抓 URL → HTML 转 markdown → 小模型按
// prompt 处理。注意事项里最重的三条：有 MCP 抓取工具优先用那个（限制更少）；
// http 自动升 https；跨域重定向会给特殊格式让模型重发请求。
// GitHub URL 建议直接走 gh CLI（结构化数据 + 已认证）。

export function makeSecondaryModelPrompt(
  markdownContent: string,
  prompt: string,
  isPreapprovedDomain: boolean,
): string {
// makeSecondaryModelPrompt：拼给 Haiku 的完整 prompt = 网页正文 + 用户问题 + 版权准则。
  const guidelines = isPreapprovedDomain
    ? `Provide a concise response based on the content above. Include relevant details, code examples, and documentation excerpts as needed.`
    : `Provide a concise response based only on the content above. In your response:
 - Enforce a strict 125-character maximum for quotes from any source document. Open Source Software is ok as long as we respect the license.
 - Use quotation marks for exact language from articles; any language outside of the quotation should never be word-for-word the same.
 - You are not a lawyer and never comment on the legality of your own prompts and responses.
 - Never produce or reproduce exact song lyrics.`
// guidelines 按域分两档：预批准域（官方文档站）鼓励带代码示例与文档摘录；
// 非预批准域执行版权约束——引文 ≤125 字符、引号外不得逐字复述、不评价合法性、
// 绝不产出歌词。

  return `
Web page content:
---
${markdownContent}
---

${prompt}

${guidelines}
`
// 模板结构：正文夹在 --- 之间，紧跟用户 prompt 与准则。
}
