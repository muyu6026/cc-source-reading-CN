/**
 * Magic Docs automatically maintains markdown documentation files marked with special headers.
 * When a file with "# MAGIC DOC: [title]" is read, it runs periodically in the background
 * using a forked subagent to update the document with new learnings from the conversation.
 *
 * See docs/magic-docs.md for more information.
 */
// 模块定位：**Magic Doc = 自带标记的 markdown 文件**。文件头写 `# MAGIC DOC: 标题`，它就会被登记；之后每次对话空闲下来，后台 fork 一个子代理，把这一轮学到的新东西**原地合并**进这份文档。所以它是「后台 fork 子代理」的第三种用法：`extractMemories` 抽记忆、`autoDream` 整理记忆、这个**维护文档**。注意最后 `initMagicDocs` 有 `USER_TYPE === 'ant'` 门——整套能力只在内部构建启用。

import type { Tool, ToolUseContext } from '../../Tool.js'
import type { BuiltInAgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import { runAgent } from '../../tools/AgentTool/runAgent.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import {
  FileReadTool,
  type Output as FileReadToolOutput,
  registerFileReadListener,
} from '../../tools/FileReadTool/FileReadTool.js'
import { isFsInaccessible } from '../../utils/errors.js'
import { cloneFileStateCache } from '../../utils/fileStateCache.js'
import {
  type REPLHookContext,
  registerPostSamplingHook,
} from '../../utils/hooks/postSamplingHooks.js'
import {
  createUserMessage,
  hasToolCallsInLastAssistantTurn,
} from '../../utils/messages.js'
import { sequential } from '../../utils/sequential.js'
import { buildMagicDocsUpdatePrompt } from './prompts.js'

// Magic Doc header pattern: # MAGIC DOC: [title]
// Matches at the start of the file (first line)
const MAGIC_DOC_HEADER_PATTERN = /^#\s*MAGIC\s+DOC:\s*(.+)$/im
// Pattern to match italics on the line immediately after the header
const ITALICS_PATTERN = /^[_*](.+?)[_*]\s*$/m
// 两个正则合起来定义了「什么是一个 Magic Doc」：头部 `# MAGIC DOC: <标题>`，紧随其后（允许一个空行）的一行**斜体**是该文档专属的更新指令。有个细节和上面注释对不上——注释说 `Matches at the start of the file (first line)`，但正则带了 `m` 标志，`^` 实际能匹配**任意一行**的行首。也就是说文件任何位置出现这一行都会被认成 Magic Doc（包括代码块里引用的写法）。注释写的是使用约定，代码比约定宽松。

// Track magic docs
type MagicDocInfo = {
  path: string
}

const trackedMagicDocs = new Map<string, MagicDocInfo>()
// 登记表是**模块级** `Map`，且只存 path、不存内容——注释里那句 the hook always reads latest content 是关键：内容每次重新读盘，所以用户在两次更新之间手改了文档也不会被旧快照覆盖。代价是每轮都要重读所有登记过的文件（数量通常个位数，可以接受）。

export function clearTrackedMagicDocs(): void {
  trackedMagicDocs.clear()
}

/**
 * Detect if a file content contains a Magic Doc header
 * Returns an object with title and optional instructions, or null if not a magic doc
 */
export function detectMagicDocHeader(
  content: string,
): { title: string; instructions?: string } | null {
  const match = content.match(MAGIC_DOC_HEADER_PATTERN)
  if (!match || !match[1]) {
    return null
  }

  const title = match[1].trim()

  // Look for italics on the next line after the header (allow one optional blank line)
  const headerEndIndex = match.index! + match[0].length
  const afterHeader = content.slice(headerEndIndex)
  // Match: newline, optional blank line, then content line
  const nextLineMatch = afterHeader.match(/^\s*\n(?:\s*\n)?(.+?)(?:\n|$)/)

  if (nextLineMatch && nextLineMatch[1]) {
    const nextLine = nextLineMatch[1]
    const italicsMatch = nextLine.match(ITALICS_PATTERN)
    if (italicsMatch && italicsMatch[1]) {
      const instructions = italicsMatch[1].trim()
      return {
        title,
        instructions,
      }
    }
  }

  return { title }
}
// `detectMagicDocHeader` 做两件事：取标题、取紧随其后的斜体指令。两处细节：① `match.index!` 用非空断言是安全的——上面已经 `if (!match) return null` 挡过；② 找下一行用的是先 slice 再正则（`/^\s*\n(?:\s*\n)?(.+?)(?:\n|$)/`），`(?:\s*\n)?` 表示**最多允许一个空行**，`(.+?)` 惰性匹配只取那一行，不会把整段正文都吃进来。

/**
 * Register a file as a Magic Doc when it's read
 * Only registers once per file path - the hook always reads latest content
 */
export function registerMagicDoc(filePath: string): void {
  // Only register if not already tracked
  if (!trackedMagicDocs.has(filePath)) {
    trackedMagicDocs.set(filePath, {
      path: filePath,
    })
  }
}
// 登记是幂等的：已经在表里就不再写。为什么要判重——`registerFileReadListener` 会在**每次读文件**时触发，同一份文档可能被读几十次；不去重的话每读一次就多一条记录，后台更新时同一文件会被并发改多轮。

/**
 * Create Magic Docs agent definition
 */
function getMagicDocsAgent(): BuiltInAgentDefinition {
  return {
    agentType: 'magic-docs',
    whenToUse: 'Update Magic Docs',
    tools: [FILE_EDIT_TOOL_NAME], // Only allow Edit
    model: 'sonnet',
    source: 'built-in',
    baseDir: 'built-in',
    getSystemPrompt: () => '', // Will use override systemPrompt
  }
}
// 子代理定义收得很紧：`tools: [FILE_EDIT_TOOL_NAME]` **只给 Edit**（不给 Write，也就没法新建文件）；`model: 'sonnet'`——文档更新是低难度任务，用便宜模型足够；`getSystemPrompt: () => ''` 返回空串是故意的，真正生效的是调用处 `override.systemPrompt`（继承主线程的系统提示，这样它才懂这个项目的上下文）。

/**
 * Update a single Magic Doc
 */
async function updateMagicDoc(
  docInfo: MagicDocInfo,
  context: REPLHookContext,
): Promise<void> {
  const { messages, systemPrompt, userContext, systemContext, toolUseContext } =
    context

  // Clone the FileStateCache to isolate Magic Docs operations. Delete this
  // doc's entry so FileReadTool's dedup doesn't return a file_unchanged
  // stub — we need the actual content to re-detect the header.
  const clonedReadFileState = cloneFileStateCache(toolUseContext.readFileState)
  clonedReadFileState.delete(docInfo.path)
  const clonedToolUseContext: ToolUseContext = {
    ...toolUseContext,
    readFileState: clonedReadFileState,
  }
// 这一段是整个文件最精巧的一处。为什么要 `cloneFileStateCache` 再 `delete` 掉本文档的条目：`FileReadTool` 有去重机制——如果同一文件在缓存里且没变，它只返回一个 `file_unchanged` 的**桩**，不给内容。而这里**必须拿到真实内容**，因为要重新解析头部（用户可能已经删了标记）。所以做法是：克隆一份文件状态缓存（不污染主线程的），把本文档的条目删掉，再用克隆出来的 context 去读——读取就必然返回全文。

  // Read the document; if deleted or unreadable, remove from tracking
  let currentDoc = ''
  try {
    const result = await FileReadTool.call(
      { file_path: docInfo.path },
      clonedToolUseContext,
    )
    const output = result.data as FileReadToolOutput
    if (output.type === 'text') {
      currentDoc = output.file.content
    }
  } catch (e: unknown) {
    // FileReadTool wraps ENOENT in a plain Error("File does not exist...") with
    // no .code, so check the message in addition to isFsInaccessible (EACCES/EPERM).
    if (
      isFsInaccessible(e) ||
      (e instanceof Error && e.message.startsWith('File does not exist'))
    ) {
      trackedMagicDocs.delete(docInfo.path)
      return
    }
    throw e
  }
// 读失败的处理分两档，注释解释了为什么需要两档：`FileReadTool` 把 ENOENT **包装成了一个普通 `Error`，消息是「File does not exist...」，但没有 `.code` 字段**，所以 `isFsInaccessible()`（只认 EACCES/EPERM 这类 errno）认不出来，必须额外比对 message 前缀。文件被删或没权限 → 从登记表里摘掉、安静退出；其他异常 → 原样抛出（那是真 bug，不该吞）。

  // Re-detect title and instructions from latest file content
  const detected = detectMagicDocHeader(currentDoc)
  if (!detected) {
    // File no longer has magic doc header, remove from tracking
    trackedMagicDocs.delete(docInfo.path)
    return
  }
// 每次更新前**重新解析头部**，解析不出来就取消登记。这一条把「标记即契约」落到了实处：用户想要停止自动维护，不用找配置，直接把文件里的 `# MAGIC DOC:` 那行删掉即可。标题和指令也一并从最新内容重读——用户在两次更新之间改了标题或斜体指令，本轮立刻生效。

  // Build update prompt with latest title and instructions
  const userPrompt = await buildMagicDocsUpdatePrompt(
    currentDoc,
    docInfo.path,
    detected.title,
    detected.instructions,
  )

  // Create a custom canUseTool that only allows Edit for magic doc files
  const canUseTool = async (tool: Tool, input: unknown) => {
    if (
      tool.name === FILE_EDIT_TOOL_NAME &&
      typeof input === 'object' &&
      input !== null &&
      'file_path' in input
    ) {
      const filePath = input.file_path
      if (typeof filePath === 'string' && filePath === docInfo.path) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
    }
    return {
      behavior: 'deny' as const,
      message: `only ${FILE_EDIT_TOOL_NAME} is allowed for ${docInfo.path}`,
      decisionReason: {
        type: 'other' as const,
        reason: `only ${FILE_EDIT_TOOL_NAME} is allowed`,
      },
    }
  }
// `canUseTool` 是一层**逐文件**沙箱：只允许 Edit、且 `input.file_path` 必须**严格等于**这一份文档的路径，其余一律 deny 并给出理由。注意它比 `autoDream` 的沙箱（整个记忆目录可写）更窄——这里连同目录的别的文件都不许碰。`updatedInput: input` 是 allow 分支的必填字段：原样透传，不做任何参数加工。

  // Run Magic Docs update using runAgent with forked context
  for await (const _message of runAgent({
    agentDefinition: getMagicDocsAgent(),
    promptMessages: [createUserMessage({ content: userPrompt })],
    toolUseContext: clonedToolUseContext,
    canUseTool,
    isAsync: true,
    forkContextMessages: messages,
    querySource: 'magic_docs',
    override: {
      systemPrompt,
      userContext,
      systemContext,
    },
    availableTools: clonedToolUseContext.options.tools,
  })) {
    // Just consume - let it run to completion
  }
// `runAgent` 的参数里有五个关键项：`isAsync: true`（后台跑，不占主循环）、`forkContextMessages: messages`（**把上面对话整段带过去**，这是它唯一的信息来源）、`querySource: 'magic_docs'`（日志与 hook 归因，也用于挡住递归）、`override`（继承主线程的 systemPrompt / userContext / systemContext）、`availableTools`（从克隆的 context 里取，与主线程工具集一致）。`for await` 只是**空循环消费**——把流跑完、不等具体消息，因为更新过程不需要逐条展示给用户。
}

/**
 * Magic Docs post-sampling hook that updates all tracked Magic Docs
 */
const updateMagicDocs = sequential(async function (
  context: REPLHookContext,
): Promise<void> {
  const { messages, querySource } = context

  if (querySource !== 'repl_main_thread') {
    return
  }

  // Only update when conversation is idle (no tool calls in last turn)
  const hasToolCalls = hasToolCallsInLastAssistantTurn(messages)
  if (hasToolCalls) {
    return
  }
// hook 的两个前置条件，一个比一个重要。① `querySource !== 'repl_main_thread'` 直接 return——**只在主线程跑**，子代理（包括它自己 fork 出来的 magic-docs 代理）里绝不触发，否则会无限自我递归。② `hasToolCallsInLastAssistantTurn` 为真就 return——**只在对话空闲时更新**：上一轮还有工具调用说明任务做到一半，此时把半成品状态写进文档，等于给未来的读者留一份错误说明。

  const docCount = trackedMagicDocs.size
  if (docCount === 0) {
    return
  }

  for (const docInfo of Array.from(trackedMagicDocs.values())) {
    await updateMagicDoc(docInfo, context)
  }
// 外层那个 `sequential()` 包装和这里的 `await` 是一对：`sequential` 保证**同一个 hook 不会并发重入**（post-sampling hook 可能被快速连续触发），逐个 `await` 保证**多份文档串行更新**。两重保险防的是同一件事——多份文档互相引用时，并行编辑会让它们各自看到对方的旧版本。
})

export async function initMagicDocs(): Promise<void> {
  if (process.env.USER_TYPE === 'ant') {
    // Register listener to detect magic docs when files are read
    registerFileReadListener((filePath: string, content: string) => {
      const result = detectMagicDocHeader(content)
      if (result) {
        registerMagicDoc(filePath)
      }
    })

    registerPostSamplingHook(updateMagicDocs)
  }
// 初始化只做两件事、并且**只在内部构建里做**：① 用 `registerFileReadListener` 监听所有文件读取，读到带标记的就登记——这是「零配置」的来源，用户不需要声明哪些是 Magic Doc，读一次就自动纳入；② 注册 post-sampling hook 执行更新。开源构建里 `USER_TYPE !== 'ant'`，两个监听都不注册，整个模块实际上处于休眠状态。
}
