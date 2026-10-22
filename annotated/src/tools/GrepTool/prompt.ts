import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'
import { BASH_TOOL_NAME } from '../BashTool/toolName.js'

export const GREP_TOOL_NAME = 'Grep'

export function getDescription(): string {
  return `A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use ${GREP_TOOL_NAME} for search tasks. NEVER invoke \`grep\` or \`rg\` as a ${BASH_TOOL_NAME} command. The ${GREP_TOOL_NAME} tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use ${AGENT_TOOL_NAME} tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use \`interface\\{\\}\` to find \`interface{}\` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like \`struct \\{[\\s\\S]*?field\`, use \`multiline: true\`
`
// 描述第一条就是禁令：永远用 Grep 工具、永远不要在 Bash 里跑 grep/rg。理由写在句尾——Grep 工具「针对正确权限与访问做过优化」（deny 规则、ignore 规则、UNC 防护都接上了），绕过工具直接调命令等于绕开所有这些防护。getDescription 是函数而非常量，因为文案里引用了 Bash/Agent 的工具名（从各自模块 import，避免硬编码字符串漂移）。
// 两条给模型的语法提示：花括号要转义（rg 不是 grep，interface{} 得写成 interface\{\}）；跨行 pattern 默认匹配不到，必须显式开 multiline。这两条是模型实际使用中最高频的翻车点，直接写进描述省排查。
}
