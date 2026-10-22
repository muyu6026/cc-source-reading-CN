import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getFsImplementation } from '../../utils/fsOperations.js'

/**
 * Get the Magic Docs update prompt template
 */
function getUpdatePromptTemplate(): string {
// 这个默认模板（下面一整段模板字符串）有三条硬约束，都是为了解决「后台代理改文档」这类任务特有的翻车方式：① 开头就声明**这条消息不属于用户对话**、且文档里不许提「documentation updates」或「magic docs」——否则子代理会把这次内部指令当成用户诉求，在正文里写一段「我更新了文档」的元叙述；② 头部必须**原样保留**（含紧随其后的斜体行）；③ 更新是 **in-place 的现状描述、不是 changelog**——明确禁止 `Previously...` / `Updated to...` 这类追加式写法，过期内容要**删掉或改写**而不是加注。第③条是文档型 agent 最容易犯的错：模型的默认倾向是「保留历史」，而这里要的恰恰是「保持与当前代码一致」。
  return `IMPORTANT: This message and these instructions are NOT part of the actual user conversation. Do NOT include any references to "documentation updates", "magic docs", or these update instructions in the document content.

Based on the user conversation above (EXCLUDING this documentation update instruction message), update the Magic Doc file to incorporate any NEW learnings, insights, or information that would be valuable to preserve.

The file {{docPath}} has already been read for you. Here are its current contents:
<current_doc_content>
{{docContents}}
</current_doc_content>

Document title: {{docTitle}}
{{customInstructions}}

Your ONLY task is to use the Edit tool to update the documentation file if there is substantial new information to add, then stop. You can make multiple edits (update multiple sections as needed) - make all Edit tool calls in parallel in a single message. If there's nothing substantial to add, simply respond with a brief explanation and do not call any tools.

CRITICAL RULES FOR EDITING:
- Preserve the Magic Doc header exactly as-is: # MAGIC DOC: {{docTitle}}
- If there's an italicized line immediately after the header, preserve it exactly as-is
- Keep the document CURRENT with the latest state of the codebase - this is NOT a changelog or history
- Update information IN-PLACE to reflect the current state - do NOT append historical notes or track changes over time
- Remove or replace outdated information rather than adding "Previously..." or "Updated to..." notes
- Clean up or DELETE sections that are no longer relevant or don't align with the document's purpose
- Fix obvious errors: typos, grammar mistakes, broken formatting, incorrect information, or confusing statements
- Keep the document well organized: use clear headings, logical section order, consistent formatting, and proper nesting

DOCUMENTATION PHILOSOPHY - READ CAREFULLY:
- BE TERSE. High signal only. No filler words or unnecessary elaboration.
- Documentation is for OVERVIEWS, ARCHITECTURE, and ENTRY POINTS - not detailed code walkthroughs
- Do NOT duplicate information that's already obvious from reading the source code
- Do NOT document every function, parameter, or line number reference
- Focus on: WHY things exist, HOW components connect, WHERE to start reading, WHAT patterns are used
- Skip: detailed implementation steps, exhaustive API docs, play-by-play narratives

What TO document:
- High-level architecture and system design
- Non-obvious patterns, conventions, or gotchas
- Key entry points and where to start reading code
- Important design decisions and their rationale
- Critical dependencies or integration points
- References to related files, docs, or code (like a wiki) - help readers navigate to relevant context

What NOT to document:
- Anything obvious from reading the code itself
- Exhaustive lists of files, functions, or parameters
- Step-by-step implementation details
- Low-level code mechanics
- Information already in CLAUDE.md or other project docs

Use the Edit tool with file_path: {{docPath}}

REMEMBER: Only update if there is substantial new information. The Magic Doc header (# MAGIC DOC: {{docTitle}}) must remain unchanged.`
}
// 模板后半段的「文档哲学 + 记什么/不记什么」两张清单值得单独看。它显式列出 NOT to document——因为 LLM 默认会把能看到的全写下来，只有明确禁令才压得住：不要记代码里一眼可见的东西、不要穷举函数与参数、不要写逐步实现细节、不要重复 CLAUDE.md 已有的内容。对应的 TO document 也很克制：高层架构、非显然的约定与坑、读代码的入口、设计决策的**理由**、以及「像 wiki 一样带读者去相关文件」的交叉引用。一句话：文档是导航，不是抄写。

/**
 * Load custom Magic Docs prompt from file if it exists
 * Custom prompts can be placed at ~/.claude/magic-docs/prompt.md
 * Use {{variableName}} syntax for variable substitution (e.g., {{docContents}}, {{docPath}}, {{docTitle}})
 */
async function loadMagicDocsPrompt(): Promise<string> {
  const fs = getFsImplementation()
  const promptPath = join(getClaudeConfigHomeDir(), 'magic-docs', 'prompt.md')

  try {
    return await fs.readFile(promptPath, { encoding: 'utf-8' })
  } catch {
    // Silently fall back to default if custom prompt doesn't exist or fails to load
    return getUpdatePromptTemplate()
  }
}
// 自定义 prompt 落在 `~/.claude/magic-docs/prompt.md`，整份替换默认模板。读失败**静默**回退——注释写了 Silently fall back。这个处理是对的：prompt 文件是用户可手改的，语法永远合法（就是一段文本），真正的失败只有「不存在」和「权限不足」两种；为了一个可选的定制文件把整个功能搞挂，不值。注意它只换模板、不换变量协议，所以自定义模板也必须用 `{{docContents}}` / `{{docPath}}` / `{{docTitle}}` / `{{customInstructions}}` 这几个占位符。

/**
 * Substitute variables in the prompt template using {{variable}} syntax
 */
function substituteVariables(
  template: string,
  variables: Record<string, string>,
): string {
  // Single-pass replacement avoids two bugs: (1) $ backreference corruption
  // (replacer fn treats $ literally), and (2) double-substitution when user
  // content happens to contain {{varName}} matching a later variable.
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key)
      ? variables[key]!
      : match,
  )
}
// `substituteVariables` 用**单遍 + 函数式 replacer** 而不是 `template.replace(/x/g, str)`，注释里点明了两个真实会发生的 bug：① **`$` 反向引用**——字符串形式替换时，`$&`、`$1`、`` $` `` 会被当成替换模式解释，而 `docContents` 是**用户文档正文**，里面完全可能出现 `$&`（比如一段 shell 或正则示例），结果文档内容被静默篡改；用函数返回值就按字面处理。② **双重替换**——如果用户内容里恰好含有 `{{docTitle}}` 这种字符串，字符串循环替换会把它二次展开；单遍扫描只走一次，替换进去的内容不会再被扫描。另外 `hasOwnProperty` 那层判断挡的是 `{{toString}}`、`{{constructor}}` 这类**原型链上的键**：不判的话 `variables['toString']` 会返回一个函数，被拼进 prompt 里。

/**
 * Build the Magic Docs update prompt with variable substitution
 */
export async function buildMagicDocsUpdatePrompt(
  docContents: string,
  docPath: string,
  docTitle: string,
  instructions?: string,
): Promise<string> {
  const promptTemplate = await loadMagicDocsPrompt()

  // Build custom instructions section if provided
  const customInstructions = instructions
    ? `

DOCUMENT-SPECIFIC UPDATE INSTRUCTIONS:
The document author has provided specific instructions for how this file should be updated. Pay extra attention to these instructions and follow them carefully:

"${instructions}"

These instructions take priority over the general rules below. Make sure your updates align with these specific guidelines.`
    : ''

  // Substitute variables in the prompt
  const variables = {
    docContents,
    docPath,
    docTitle,
    customInstructions,
  }

  return substituteVariables(promptTemplate, variables)
}
// 最后一步把四组变量塞进模板。`customInstructions` 是**先拼好再作为变量插值**的，位置在标题之后、通用规则之前，措辞明确写了 These instructions take priority over the general rules below——所以单份文档可以覆盖全局文档哲学（比如某个文件就想保留变更历史）。这条设计让「默认规则严格、个别文档例外」成为可能，而不用去改全局 prompt。
