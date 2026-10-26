// 文件级：本文件是用户单条输入的「处理基座」——承接 handlePromptSubmit 传来的输入，做图片缩放、附件抽取、粘贴图片处理、斜杠命令/ultraplan 关键词/bash 命令路由，最终交给 processTextPrompt 生成用户消息。
import { feature } from 'bun:bundle'
import type {
  Base64ImageSource,
  ContentBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import { randomUUID } from 'crypto'
import type { QuerySource } from 'src/constants/querySource.js'
import { logEvent } from 'src/services/analytics/index.js'
import { getContentText } from 'src/utils/messages.js'
import {
  findCommand,
  getCommandName,
  isBridgeSafeCommand,
  type LocalJSXCommandContext,
} from '../../commands.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { IDESelection } from '../../hooks/useIdeSelection.js'
import type { SetToolJSXFn, ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ProgressMessage,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import type { PermissionMode } from '../../types/permissions.js'
import {
  isValidImagePaste,
  type PromptInputMode,
} from '../../types/textInputTypes.js'
import {
  type AgentMentionAttachment,
  createAttachmentMessage,
  getAttachmentMessages,
} from '../attachments.js'
import type { PastedContent } from '../config.js'
import type { EffortValue } from '../effort.js'
import { toArray } from '../generators.js'
import {
  executeUserPromptSubmitHooks,
  getUserPromptSubmitHookBlockingMessage,
} from '../hooks.js'
import {
  createImageMetadataText,
  maybeResizeAndDownsampleImageBlock,
} from '../imageResizer.js'
import { storeImages } from '../imageStore.js'
import {
  createCommandInputMessage,
  createSystemMessage,
  createUserMessage,
} from '../messages.js'
import { queryCheckpoint } from '../queryProfiler.js'
import { parseSlashCommand } from '../slashCommandParsing.js'
import {
  hasUltraplanKeyword,
  replaceUltraplanKeyword,
} from '../ultraplan/keyword.js'
import { processTextPrompt } from './processTextPrompt.js'
export type ProcessUserInputContext = ToolUseContext & LocalJSXCommandContext
// `ProcessUserInputContext`：处理输入所需的上下文，由 ToolUseContext 与本地 JSX 命令上下文合并而成。

export type ProcessUserInputBaseResult = {
// `ProcessUserInputBaseResult`：处理结果——消息数组、是否查询、允许的工具、模型、effort、链式下一条输入等。
  messages: (
    | UserMessage
    | AssistantMessage
    | AttachmentMessage
    | SystemMessage
    | ProgressMessage
  )[]
  shouldQuery: boolean
  allowedTools?: string[]
  model?: string
  effort?: EffortValue
  // Output text for non-interactive mode (e.g., forked commands)
  // When set, this is used as the result in -p mode instead of empty string
  resultText?: string
  // When set, prefills or submits the next input after command completes
  // Used by /discover to chain into the selected feature's command
  nextInput?: string
  submitNextInput?: boolean
}

// `processUserInput`：对外入口，先做轻量展示（非 meta 的 prompt 立即显示输入），再调用 processUserInputBase，最后跑 UserPromptSubmit 钩子处理阻断/附加上下文。
export async function processUserInput({
  input,
  preExpansionInput,
  mode,
  setToolJSX,
  context,
  pastedContents,
  ideSelection,
  messages,
  setUserInputOnProcessing,
  uuid,
  isAlreadyProcessing,
  querySource,
  canUseTool,
  skipSlashCommands,
  bridgeOrigin,
  isMeta,
  skipAttachments,
}: {
  input: string | Array<ContentBlockParam>
  /**
   * Input before [Pasted text #N] expansion. Used for ultraplan keyword
   * detection so pasted content containing the word cannot trigger. Falls
   * back to the string `input` when unset.
   */
  preExpansionInput?: string
  mode: PromptInputMode
  setToolJSX: SetToolJSXFn
  context: ProcessUserInputContext
  pastedContents?: Record<number, PastedContent>
  ideSelection?: IDESelection
  messages?: Message[]
  setUserInputOnProcessing?: (prompt?: string) => void
  uuid?: string
  isAlreadyProcessing?: boolean
  querySource?: QuerySource
  canUseTool?: CanUseToolFn
  /**
   * When true, input starting with `/` is treated as plain text.
   * Used for remotely-received messages (bridge/CCR) that should not
   * trigger local slash commands or skills.
   */
  skipSlashCommands?: boolean
  /**
   * When true, slash commands matching isBridgeSafeCommand() execute even
   * though skipSlashCommands is set. See QueuedCommand.bridgeOrigin.
   */
  bridgeOrigin?: boolean
  /**
   * When true, the resulting UserMessage gets `isMeta: true` (user-hidden,
   * model-visible). Propagated from `QueuedCommand.isMeta` for queued
   * system-generated prompts.
   */
  isMeta?: boolean
  skipAttachments?: boolean
}): Promise<ProcessUserInputBaseResult> {
  const inputString = typeof input === 'string' ? input : null
// meta 系统生成提示（如定时任务）不立即显示输入，应静默运行。
  // Immediately show the user input prompt while we are still processing the input.
  // Skip for isMeta (system-generated prompts like scheduled tasks) — those
  // should run invisibly.
  if (mode === 'prompt' && inputString !== null && !isMeta) {
    setUserInputOnProcessing?.(inputString)
  }

  queryCheckpoint('query_process_user_input_base_start')

  const appState = context.getAppState()

  const result = await processUserInputBase(
    input,
    mode,
    setToolJSX,
    context,
    pastedContents,
    ideSelection,
    messages,
    uuid,
    isAlreadyProcessing,
    querySource,
    canUseTool,
    appState.toolPermissionContext.mode,
    skipSlashCommands,
    bridgeOrigin,
    isMeta,
    skipAttachments,
    preExpansionInput,
  )
  queryCheckpoint('query_process_user_input_base_end')

  if (!result.shouldQuery) {
    return result
  }

  // Execute UserPromptSubmit hooks and handle blocking
// 执行 UserPromptSubmit 钩子：遇阻断错误用系统消息覆盖原输入；遇 preventContinuation 则保留输入并停止；遇附加上下文则追加到消息。
  queryCheckpoint('query_hooks_start')
  const inputMessage = getContentText(input) || ''

  for await (const hookResult of executeUserPromptSubmitHooks(
    inputMessage,
    appState.toolPermissionContext.mode,
    context,
    context.requestPrompt,
  )) {
    // We only care about the result
    if (hookResult.message?.type === 'progress') {
      continue
    }

    // Return only a system-level error message, erasing the original user input
    if (hookResult.blockingError) {
      const blockingMessage = getUserPromptSubmitHookBlockingMessage(
        hookResult.blockingError,
      )
      return {
        messages: [
          // TODO: Make this an attachment message
          createSystemMessage(
            `${blockingMessage}\n\nOriginal prompt: ${input}`,
            'warning',
          ),
        ],
        shouldQuery: false,
        allowedTools: result.allowedTools,
      }
    }

    // If preventContinuation is set, stop processing but keep the original
    // prompt in context.
    if (hookResult.preventContinuation) {
      const message = hookResult.stopReason
        ? `Operation stopped by hook: ${hookResult.stopReason}`
        : 'Operation stopped by hook'
      result.messages.push(
        createUserMessage({
          content: message,
        }),
      )
      result.shouldQuery = false
      return result
    }

    // Collect additional contexts
    if (
      hookResult.additionalContexts &&
      hookResult.additionalContexts.length > 0
    ) {
      result.messages.push(
        createAttachmentMessage({
          type: 'hook_additional_context',
          content: hookResult.additionalContexts.map(applyTruncation),
          hookName: 'UserPromptSubmit',
          toolUseID: `hook-${randomUUID()}`,
          hookEvent: 'UserPromptSubmit',
        }),
      )
    }

    // TODO: Clean this up
    if (hookResult.message) {
      switch (hookResult.message.attachment.type) {
        case 'hook_success':
          if (!hookResult.message.attachment.content) {
            // Skip if there is no content
            break
          }
          result.messages.push({
            ...hookResult.message,
            attachment: {
              ...hookResult.message.attachment,
              content: applyTruncation(hookResult.message.attachment.content),
            },
          })
          break
        default:
          result.messages.push(hookResult.message)
          break
      }
    }
  }
  queryCheckpoint('query_hooks_end')

  // Happy path: onQuery will clear userInputOnProcessing via startTransition
  // so it resolves in the same frame as deferredMessages (no flicker gap).
  // Error paths are handled by handlePromptSubmit's finally block.
  return result
}

const MAX_HOOK_OUTPUT_LENGTH = 10000
// `MAX_HOOK_OUTPUT_LENGTH` 与 `applyTruncation`：钩子输出超过 1 万字符时截断，避免超大附加上下文撑爆上下文。

function applyTruncation(content: string): string {
  if (content.length > MAX_HOOK_OUTPUT_LENGTH) {
    return `${content.substring(0, MAX_HOOK_OUTPUT_LENGTH)}… [output truncated - exceeded ${MAX_HOOK_OUTPUT_LENGTH} characters]`
  }
  return content
}

// `processUserInputBase`：实际路由核心——先统一图片块（缩放/降采样并抽元数据），再分发到 bash/斜杠/普通 prompt 三类处理。
async function processUserInputBase(
  input: string | Array<ContentBlockParam>,
  mode: PromptInputMode,
  setToolJSX: SetToolJSXFn,
  context: ProcessUserInputContext,
  pastedContents?: Record<number, PastedContent>,
  ideSelection?: IDESelection,
  messages?: Message[],
  uuid?: string,
  isAlreadyProcessing?: boolean,
  querySource?: QuerySource,
  canUseTool?: CanUseToolFn,
  permissionMode?: PermissionMode,
  skipSlashCommands?: boolean,
  bridgeOrigin?: boolean,
  isMeta?: boolean,
  skipAttachments?: boolean,
  preExpansionInput?: string,
): Promise<ProcessUserInputBaseResult> {
  let inputString: string | null = null
  let precedingInputBlocks: ContentBlockParam[] = []

  // Collect image metadata texts for isMeta message
  const imageMetadataTexts: string[] = []

  // Normalized view of `input` with image blocks resized. For string input
  // this is just `input`; for array input it's the processed blocks. We pass
  // this (not raw `input`) to processTextPrompt so resized/normalized image
  // blocks actually reach the API — otherwise the resize work above is
  // discarded for the regular prompt path. Also normalizes bridge inputs
  // where iOS may send `mediaType` instead of `media_type` (mobile-apps#5825).
// `normalizedInput`：图片已缩放归一化后的输入视图，传给 processTextPrompt 以保证缩放成果真正抵达 API（移动端可能字段名不一致也在此修正）。
  let normalizedInput: string | ContentBlockParam[] = input

  if (typeof input === 'string') {
    inputString = input
  } else if (input.length > 0) {
    queryCheckpoint('query_image_processing_start')
    const processedBlocks: ContentBlockParam[] = []
    for (const block of input) {
      if (block.type === 'image') {
        const resized = await maybeResizeAndDownsampleImageBlock(block)
        // Collect image metadata for isMeta message
        if (resized.dimensions) {
          const metadataText = createImageMetadataText(resized.dimensions)
          if (metadataText) {
            imageMetadataTexts.push(metadataText)
          }
        }
        processedBlocks.push(resized.block)
      } else {
        processedBlocks.push(block)
      }
    }
    normalizedInput = processedBlocks
    queryCheckpoint('query_image_processing_end')
    // Extract the input string from the last content block if it is text,
    // and keep track of the preceding content blocks
    const lastBlock = processedBlocks[processedBlocks.length - 1]
    if (lastBlock?.type === 'text') {
      inputString = lastBlock.text
      precedingInputBlocks = processedBlocks.slice(0, -1)
    } else {
      precedingInputBlocks = processedBlocks
    }
  }

  if (inputString === null && mode !== 'prompt') {
    throw new Error(`Mode: ${mode} requires a string input.`)
  }

  // Extract and convert image content to content blocks early
  // Keep track of IDs in order for message storage
  const imageContents = pastedContents
// 粘贴图片先落盘存储（供 CLI 工具操作/上传 PR），再并行缩放并收集元数据与内容块。
    ? Object.values(pastedContents).filter(isValidImagePaste)
    : []
  const imagePasteIds = imageContents.map(img => img.id)

  // Store images to disk so Claude can reference the path in context
  // (for manipulation with CLI tools, uploading to PRs, etc.)
  const storedImagePaths = pastedContents
    ? await storeImages(pastedContents)
    : new Map<number, string>()

  // Resize pasted images to ensure they fit within API limits (parallel processing)
  queryCheckpoint('query_pasted_image_processing_start')
  const imageProcessingResults = await Promise.all(
    imageContents.map(async pastedImage => {
      const imageBlock: ImageBlockParam = {
        type: 'image',
        source: {
          type: 'base64',
          media_type: (pastedImage.mediaType ||
            'image/png') as Base64ImageSource['media_type'],
          data: pastedImage.content,
        },
      }
      logEvent('tengu_pasted_image_resize_attempt', {
        original_size_bytes: pastedImage.content.length,
      })
      const resized = await maybeResizeAndDownsampleImageBlock(imageBlock)
      return {
        resized,
        originalDimensions: pastedImage.dimensions,
        sourcePath:
          pastedImage.sourcePath ?? storedImagePaths.get(pastedImage.id),
      }
    }),
  )
  // Collect results preserving order
  const imageContentBlocks: ContentBlockParam[] = []
  for (const {
    resized,
    originalDimensions,
    sourcePath,
  } of imageProcessingResults) {
    // Collect image metadata for isMeta message (prefer resized dimensions)
    if (resized.dimensions) {
      const metadataText = createImageMetadataText(
        resized.dimensions,
        sourcePath,
      )
      if (metadataText) {
        imageMetadataTexts.push(metadataText)
      }
    } else if (originalDimensions) {
      // Fall back to original dimensions if resize didn't provide them
      const metadataText = createImageMetadataText(
        originalDimensions,
        sourcePath,
      )
      if (metadataText) {
        imageMetadataTexts.push(metadataText)
      }
    } else if (sourcePath) {
      // If we have a source path but no dimensions, still add source info
      imageMetadataTexts.push(`[Image source: ${sourcePath}]`)
    }
    imageContentBlocks.push(resized.block)
  }
  queryCheckpoint('query_pasted_image_processing_end')

  // Bridge-safe slash command override: mobile/web clients set bridgeOrigin
  // with skipSlashCommands still true (defense-in-depth against exit words and
  // immediate-command fast paths). Resolve the command here — if it passes
  // isBridgeSafeCommand, clear the skip so the gate below opens. If it's a
  // known-but-unsafe command (local-jsx UI or terminal-only), short-circuit
  // with a helpful message rather than letting the model see raw "/config".
// 桥接安全斜杠命令覆盖：远程客户端设 bridgeOrigin 但仍 skipSlash，若命令通过 isBridgeSafeCommand 则放行，否则返回友好提示而非让模型看到裸 `/config`。
  let effectiveSkipSlash = skipSlashCommands
  if (bridgeOrigin && inputString !== null && inputString.startsWith('/')) {
    const parsed = parseSlashCommand(inputString)
    const cmd = parsed
      ? findCommand(parsed.commandName, context.options.commands)
      : undefined
    if (cmd) {
      if (isBridgeSafeCommand(cmd)) {
        effectiveSkipSlash = false
      } else {
        const msg = `/${getCommandName(cmd)} isn't available over Remote Control.`
        return {
          messages: [
            createUserMessage({ content: inputString, uuid }),
            createCommandInputMessage(
              `<local-command-stdout>${msg}</local-command-stdout>`,
            ),
          ],
          shouldQuery: false,
          resultText: msg,
        }
      }
    }
    // Unknown /foo or unparseable — fall through to plain text, same as
    // pre-#19134. A mobile user typing "/shrug" shouldn't see "Unknown skill".
  }

  // Ultraplan keyword — route through /ultraplan. Detect on the
  // pre-expansion input so pasted content containing the word cannot
  // trigger a CCR session; replace with "plan" in the expanded input so
  // the CCR prompt receives paste contents and stays grammatical. See
  // keyword.ts for the quote/path exclusions. Interactive prompt mode +
  // non-slash-prefixed only:
  // headless/print mode filters local-jsx commands out of context.options,
  // so routing to /ultraplan there yields "Unknown skill" — and there's no
  // rainbow animation in print mode anyway.
  // Runs before attachment extraction so this path matches the slash-command
  // path below (no await between setUserInputOnProcessing and setAppState —
  // React batches both into one render, no flash).
// ultraplan 关键词路由：在展开前输入上检测，命中且为交互 prompt 模式时改写并转 `/ultraplan`，避免 CCR 会话被粘贴内容误触发。
  if (
    feature('ULTRAPLAN') &&
    mode === 'prompt' &&
    !context.options.isNonInteractiveSession &&
    inputString !== null &&
    !effectiveSkipSlash &&
    !inputString.startsWith('/') &&
    !context.getAppState().ultraplanSessionUrl &&
    !context.getAppState().ultraplanLaunching &&
    hasUltraplanKeyword(preExpansionInput ?? inputString)
  ) {
    logEvent('tengu_ultraplan_keyword', {})
    const rewritten = replaceUltraplanKeyword(inputString).trim()
    const { processSlashCommand } = await import('./processSlashCommand.js')
    const slashResult = await processSlashCommand(
      `/ultraplan ${rewritten}`,
      precedingInputBlocks,
      imageContentBlocks,
      [],
      context,
      setToolJSX,
      uuid,
      isAlreadyProcessing,
      canUseTool,
    )
    return addImageMetadataMessage(slashResult, imageMetadataTexts)
  }

  // For slash commands, attachments will be extracted within getMessagesForSlashCommand
// 附件抽取条件：非跳过、有字符串输入、且（非 prompt 模式或桥接/非斜杠开头）时才抽取。
  const shouldExtractAttachments =
    !skipAttachments &&
    inputString !== null &&
    (mode !== 'prompt' || effectiveSkipSlash || !inputString.startsWith('/'))

  queryCheckpoint('query_attachment_loading_start')
  const attachmentMessages = shouldExtractAttachments
    ? await toArray(
        getAttachmentMessages(
          inputString,
          context,
          ideSelection ?? null,
          [], // queuedCommands - handled by query.ts for mid-turn attachments
          messages,
          querySource,
        ),
      )
    : []
  queryCheckpoint('query_attachment_loading_end')

  // Bash commands
  if (inputString !== null && mode === 'bash') {
// bash 模式：动态 import 走 processBashCommand。
    const { processBashCommand } = await import('./processBashCommand.js')
    return addImageMetadataMessage(
      await processBashCommand(
        inputString,
        precedingInputBlocks,
        attachmentMessages,
        context,
        setToolJSX,
      ),
      imageMetadataTexts,
    )
  }

  // Slash commands
  // Skip for remote bridge messages — input from CCR clients is plain text
// 斜杠命令：动态 import 走 processSlashCommand（远程桥接消息跳过此分支）。
  if (
    inputString !== null &&
    !effectiveSkipSlash &&
    inputString.startsWith('/')
  ) {
    const { processSlashCommand } = await import('./processSlashCommand.js')
    const slashResult = await processSlashCommand(
      inputString,
      precedingInputBlocks,
      imageContentBlocks,
      attachmentMessages,
      context,
      setToolJSX,
      uuid,
      isAlreadyProcessing,
      canUseTool,
    )
    return addImageMetadataMessage(slashResult, imageMetadataTexts)
  }

  // Log agent mention queries for analysis
  if (inputString !== null && mode === 'prompt') {
// prompt 模式下统计 @agent-<name> 提及并打点，供子智能体调度分析。
    const trimmedInput = inputString.trim()

    const agentMention = attachmentMessages.find(
      (m): m is AttachmentMessage<AgentMentionAttachment> =>
        m.attachment.type === 'agent_mention',
    )

    if (agentMention) {
      const agentMentionString = `@agent-${agentMention.attachment.agentType}`
      const isSubagentOnly = trimmedInput === agentMentionString
      const isPrefix =
        trimmedInput.startsWith(agentMentionString) && !isSubagentOnly

      // Log whenever users use @agent-<name> syntax
      logEvent('tengu_subagent_at_mention', {
        is_subagent_only: isSubagentOnly,
        is_prefix: isPrefix,
      })
    }
  }

  // Regular user prompt
// 普通用户 prompt：把归一化输入、图片块、附件等交给 processTextPrompt 生成用户消息。
  return addImageMetadataMessage(
    processTextPrompt(
      normalizedInput,
      imageContentBlocks,
      imagePasteIds,
      attachmentMessages,
      uuid,
      permissionMode,
      isMeta,
    ),
    imageMetadataTexts,
  )
}

// `addImageMetadataMessage`：把收集到的图片元数据以 isMeta 消息追加进结果，供模型了解图片尺寸/来源但不打扰用户。
// Adds image metadata texts as isMeta message to result
function addImageMetadataMessage(
  result: ProcessUserInputBaseResult,
  imageMetadataTexts: string[],
): ProcessUserInputBaseResult {
  if (imageMetadataTexts.length > 0) {
    result.messages.push(
      createUserMessage({
        content: imageMetadataTexts.map(text => ({ type: 'text', text })),
        isMeta: true,
      }),
    )
  }
  return result
}
