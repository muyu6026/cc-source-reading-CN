// ═══════════════════════════════════════════════════════════════
//  api/errors：1,207 行的「错误翻译层」
// ═══════════════════════════════════════════════════════════════
//
//  这是 services/api/ 里最长的文件，也是最没有算法、最考验耐心的一个。
//  它做三件事，各自服务于不同的读者：
//
//      常量 + getXxxErrorMessage   给**用户**看的中文/英文句子
//      getAssistantMessageFromError  把异常转成一条「assistant 消息」
//      classifyAPIError            给**埋点**用的标签（Datadog tag）
//
//  为什么错误要转成「assistant 消息」而不是 throw 出去？这是这份代码
//  最重要的一个设计，见第 425 行。
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from '@anthropic-ai/sdk'
import type {
  BetaMessage,
  BetaStopReason,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { AFK_MODE_BETA_HEADER } from 'src/constants/betas.js'
import type { SDKAssistantMessageError } from 'src/entrypoints/agentSdkTypes.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from 'src/types/message.js'
import {
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
  getOauthAccountInfo,
  isClaudeAISubscriber,
} from 'src/utils/auth.js'
import {
  createAssistantAPIErrorMessage,
  NO_RESPONSE_REQUESTED,
} from 'src/utils/messages.js'
import {
  getDefaultMainLoopModelSetting,
  isNonCustomOpusModel,
} from 'src/utils/model/model.js'
import { getModelStrings } from 'src/utils/model/modelStrings.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import {
  API_PDF_MAX_PAGES,
  PDF_TARGET_RAW_SIZE,
} from '../../constants/apiLimits.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { formatFileSize } from '../../utils/format.js'
import { ImageResizeError } from '../../utils/imageResizer.js'
import { ImageSizeError } from '../../utils/imageValidation.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  type ClaudeAILimits,
  getRateLimitErrorMessage,
  type OverageDisabledReason,
} from '../claudeAiLimits.js'
import { shouldProcessRateLimits } from '../rateLimitMocking.js' // Used for /mock-limits command
import { extractConnectionErrorDetails, formatAPIError } from './errorUtils.js'

// 【一个前缀常量，被两处反向解析】
//
//      API_ERROR_MESSAGE_PREFIX = 'API Error'
//      startsWithApiErrorPrefix(text)  用 startsWith 判断
//
//  注意：**文案是被人解析的**。写文案和读文案分在两个文件里 ——
//  这里生成 'API Error: ...'，UI 那边用 startsWith 认出「这是一条错误」，
//  然后换一种渲染方式（标红、不折叠）。
//
//  这就是一个隐式的协议：改文案等于改协议。所以下面几十个常量全部是
//  `export const`，而且 UI 那边不是硬编码字符串而是 import 这个常量。
//
//  判据：**当一个字符串要同时被「展示」和「判断」，它就该是常量，
//  而且不该在判断侧硬编码字面量。**
export const API_ERROR_MESSAGE_PREFIX = 'API Error'

export function startsWithApiErrorPrefix(text: string): boolean {
  return (
    text.startsWith(API_ERROR_MESSAGE_PREFIX) ||
    text.startsWith(`Please run /login · ${API_ERROR_MESSAGE_PREFIX}`)
  )
}
export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt is too long'

export function isPromptTooLongMessage(msg: AssistantMessage): boolean {
  if (!msg.isApiErrorMessage) {
    return false
  }
  const content = msg.message.content
  if (!Array.isArray(content)) {
    return false
  }
  return content.some(
    block =>
      block.type === 'text' &&
      block.text.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE),
  )
}

// 【解析 token 数，正则写得故意很松】
//
//      /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i
//
//  注释（第 82 行）说明了为什么要松：raw string 可能被 SDK 前缀包住、
//  可能被 JSON 信封包住、大小写还可能不同（Vertex）。
//
//  所以策略是：**只锚定「不变的部分」**，中间的噪音用 `[^0-9]*` 一锅吞。
//  这样写出来的正则对格式变化极有韧性 —— 只要「prompt is too long」
//  后面跟着两个数字、中间有个大于号，就能解析出来。
//
//  反面写法是把整句 `prompt is too long: 137500 tokens > 135000 maximum`
//  完整匹配，那样服务端改一个空格就全废。
//
//  解析结果用 undefined 而不是 0 表示「不知道」—— 因为 0 是个合法值
//  （0 tokens 超出？不可能，但类型上不能排除），用 0 会让下游误判。
/**
 * Parse actual/limit token counts from a raw prompt-too-long API error
 * message like "prompt is too long: 137500 tokens > 135000 maximum".
 * The raw string may be wrapped in SDK prefixes or JSON envelopes, or
 * have different casing (Vertex), so this is intentionally lenient.
 */
export function parsePromptTooLongTokenCounts(rawMessage: string): {
  actualTokens: number | undefined
  limitTokens: number | undefined
} {
  const match = rawMessage.match(
    /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i,
  )
  return {
    actualTokens: match ? parseInt(match[1]!, 10) : undefined,
    limitTokens: match ? parseInt(match[2]!, 10) : undefined,
  }
}

/**
 * Returns how many tokens over the limit a prompt-too-long error reports,
 * or undefined if the message isn't PTL or its errorDetails are unparseable.
 * Reactive compact uses this gap to jump past multiple groups in one retry
 * instead of peeling one-at-a-time.
 */
export function getPromptTooLongTokenGap(
  msg: AssistantMessage,
): number | undefined {
  if (!isPromptTooLongMessage(msg) || !msg.errorDetails) {
    return undefined
  }
  const { actualTokens, limitTokens } = parsePromptTooLongTokenCounts(
    msg.errorDetails,
  )
  if (actualTokens === undefined || limitTokens === undefined) {
    return undefined
  }
  const gap = actualTokens - limitTokens
  return gap > 0 ? gap : undefined
}

// 【这段 13 行的注释在描述一个循环依赖，值得逐句读】
//
//  三个地方必须保持同步：
//
//      第 523 / 560 / 573 行左右   getAssistantMessageFromError 里设置 errorDetails 的分支
//      第 929-946 行左右           classifyAPIError 里对应的分支
//      本函数 isMediaSizeError     判断 errorDetails 是不是「媒体太大」
//
//  然后注释说了一件很微妙的事：
//
//      The closed loop: errorDetails is only set after those branches already
//      matched these same substrings, so isMediaSizeError(errorDetails) is
//      tautologically true for that path.
//
//  翻译：errorDetails 只会在「那三个分支已经匹配过同样的子串」之后才被设置。
//  所以只要 errorDetails 有值，isMediaSizeError 必然为真 —— **恒真**。
//
//  那还判断它干什么？为了「防御未来的漂移」：
//
//      API wording drift causes graceful degradation (errorDetails stays
//      undefined, caller short-circuits), not a false negative.
//
//  也就是说，如果哪天服务端改了措辞，导致那三个分支匹配不上，
//  errorDetails 就不会被设置，于是 isMediaSizeError 返回 false，
//  调用方走「不重试」的分支 —— 功能降级，但**不会误判成媒体错误然后
//  把图片全删了**。
//
//  这是一个「恒真判断为什么还要写」的完整答案：它守的不是当下，是未来。
//  代价是三处字符串必须同步，作者用注释把这个隐性契约写下来了。
/**
 * Is this raw API error text a media-size rejection that stripImagesFromMessages
 * can fix? Reactive compact's summarize retry uses this to decide whether to
 * strip and retry (media error) or bail (anything else).
 *
 * Patterns MUST stay in sync with the getAssistantMessageFromError branches
 * that populate errorDetails (~L523 PDF, ~L560 image, ~L573 many-image) and
 * the classifyAPIError branches (~L929-946). The closed loop: errorDetails is
 * only set after those branches already matched these same substrings, so
 * isMediaSizeError(errorDetails) is tautologically true for that path. API
 * wording drift causes graceful degradation (errorDetails stays undefined,
 * caller short-circuits), not a false negative.
 */
export function isMediaSizeError(raw: string): boolean {
  return (
    (raw.includes('image exceeds') && raw.includes('maximum')) ||
    (raw.includes('image dimensions exceed') && raw.includes('many-image')) ||
    /maximum of \d+ PDF pages/.test(raw)
  )
}

/**
 * Message-level predicate: is this assistant message a media-size rejection?
 * Parallel to isPromptTooLongMessage. Checks errorDetails (the raw API error
 * string populated by the getAssistantMessageFromError branches at ~L523/560/573)
 * rather than content text, since media errors have per-variant content strings.
 */
export function isMediaSizeErrorMessage(msg: AssistantMessage): boolean {
  return (
    msg.isApiErrorMessage === true &&
    msg.errorDetails !== undefined &&
    isMediaSizeError(msg.errorDetails)
  )
}
export const CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE = 'Credit balance is too low'
export const INVALID_API_KEY_ERROR_MESSAGE = 'Not logged in · Please run /login'
export const INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL =
  'Invalid API key · Fix external API key'
export const ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH =
  'Your ANTHROPIC_API_KEY belongs to a disabled organization · Unset the environment variable to use your subscription instead'
export const ORG_DISABLED_ERROR_MESSAGE_ENV_KEY =
  'Your ANTHROPIC_API_KEY belongs to a disabled organization · Update or unset the environment variable'
export const TOKEN_REVOKED_ERROR_MESSAGE =
  'OAuth token revoked · Please run /login'
export const CCR_AUTH_ERROR_MESSAGE =
  'Authentication error · This may be a temporary network issue, please try again'
export const REPEATED_529_ERROR_MESSAGE = 'Repeated 529 Overloaded errors'
export const CUSTOM_OFF_SWITCH_MESSAGE =
  'Opus is experiencing high load, please use /model to switch to Sonnet'
export const API_TIMEOUT_ERROR_MESSAGE = 'Request timed out'
// 【同一句话，两个版本 —— 交互模式和非交互模式】
//
//      PDF too large (...). Double press esc to go back and try again, ...
//      PDF too large (...). Try reading the file a different way (e.g., pdftotext).
//
//  差别不是措辞，是**用户能做什么**：
//
//      交互模式   有界面、能按 esc 回到上一步 → 告诉他按 esc
//      非交互模式 claude -p 或 SDK 调用，没有「上一步」→ 告诉他换个做法
//
//  这是全文件里出现最频繁的一个模式（第 170 / 176 / 181 / 186 / 191 /
//  200 / 206 行都是），而且每一处都是 getIsNonInteractiveSession() 三目。
//
//  判据：**错误文案必须针对「当前这个用户能采取的动作」写，不能只描述错误。**
//  在 -p 模式下告诉用户「双击 esc」，等于什么都没说。
//
//  顺带注意 limits 那一行把常量拼进文案：API_PDF_MAX_PAGES 和
//  PDF_TARGET_RAW_SIZE 是 import 来的，所以服务端限制改了，文案自动跟着改。
export function getPdfTooLargeErrorMessage(): string {
  const limits = `max ${API_PDF_MAX_PAGES} pages, ${formatFileSize(PDF_TARGET_RAW_SIZE)}`
  return getIsNonInteractiveSession()
    ? `PDF too large (${limits}). Try reading the file a different way (e.g., extract text with pdftotext).`
    : `PDF too large (${limits}). Double press esc to go back and try again, or use pdftotext to convert to text first.`
}
export function getPdfPasswordProtectedErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'PDF is password protected. Try using a CLI tool to extract or convert the PDF.'
    : 'PDF is password protected. Please double press esc to edit your message and try again.'
}
export function getPdfInvalidErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'The PDF file was not valid. Try converting it to text first (e.g., pdftotext).'
    : 'The PDF file was not valid. Double press esc to go back and try again with a different file.'
}
export function getImageTooLargeErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'Image was too large. Try resizing the image or using a different approach.'
    : 'Image was too large. Double press esc to go back and try again with a smaller image.'
}
export function getRequestTooLargeErrorMessage(): string {
  const limits = `max ${formatFileSize(PDF_TARGET_RAW_SIZE)}`
  return getIsNonInteractiveSession()
    ? `Request too large (${limits}). Try with a smaller file.`
    : `Request too large (${limits}). Double press esc to go back and try with a smaller file.`
}
export const OAUTH_ORG_NOT_ALLOWED_ERROR_MESSAGE =
  'Your account does not have access to Claude Code. Please run /login.'

export function getTokenRevokedErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'Your account does not have access to Claude. Please login again or contact your administrator.'
    : TOKEN_REVOKED_ERROR_MESSAGE
}

export function getOauthOrgNotAllowedErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'Your organization does not have access to Claude. Please login again or contact your administrator.'
    : OAUTH_ORG_NOT_ALLOWED_ERROR_MESSAGE
}

/**
 * Check if we're in CCR (Claude Code Remote) mode.
 * In CCR mode, auth is handled via JWTs provided by the infrastructure,
 * not via /login. Transient auth errors should suggest retrying, not logging in.
 */
function isCCRMode(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
}

// Temp helper to log tool_use/tool_result mismatch errors
// 【为了发一条埋点，写了一个 150 行的函数】
//
//  这个函数只在一种错误下被调用：400「tool_use ids were found without
//  tool_result blocks immediately after」。也就是消息序列里工具调用和
//  结果没配对。
//
//  它做的事：在**归一化后**的 messages 里找到那个 tool_use 的位置，
//  在**原始的** messages 里也找到，然后把两边「这条之后的所有块」都
//  压成一个字符串序列，一起上报。
//
//  为什么要两份？因为归一化会合并/拆分消息，原始序列才是用户实际发生的。
//  两边的差异就是 bug 的线索 —— **对照两个视图，是定位「转换过程中丢东西」
//  这类 bug 的标准手法。**
//
//  注意整个函数包在 try 里（第 227 行），注释写着 Temp helper。
//  也就是说：这是一个**排障用的临时代码**，它自己出错绝不能让错误处理
//  流程崩掉 —— 因为它的调用点在错误处理链上。
//
//  这类代码的判据：功能是「采样诊断」，那么它的可靠性要求低于宿主流程，
//  必须自己吞掉异常。
function logToolUseToolResultMismatch(
  toolUseId: string,
  messages: Message[],
  messagesForAPI: (UserMessage | AssistantMessage)[],
): void {
  try {
    // Find tool_use in normalized messages
    let normalizedIndex = -1
    for (let i = 0; i < messagesForAPI.length; i++) {
      const msg = messagesForAPI[i]
      if (!msg) continue
      const content = msg.message.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block.type === 'tool_use' &&
            'id' in block &&
            block.id === toolUseId
          ) {
            normalizedIndex = i
            break
          }
        }
      }
      if (normalizedIndex !== -1) break
    }

    // Find tool_use in original messages
    let originalIndex = -1
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (!msg) continue
      if (msg.type === 'assistant' && 'message' in msg) {
        const content = msg.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block.type === 'tool_use' &&
              'id' in block &&
              block.id === toolUseId
            ) {
              originalIndex = i
              break
            }
          }
        }
      }
      if (originalIndex !== -1) break
    }

    // Build normalized sequence
    const normalizedSeq: string[] = []
    for (let i = normalizedIndex + 1; i < messagesForAPI.length; i++) {
      const msg = messagesForAPI[i]
      if (!msg) continue
      const content = msg.message.content
      if (Array.isArray(content)) {
        for (const block of content) {
          const role = msg.message.role
          if (block.type === 'tool_use' && 'id' in block) {
            normalizedSeq.push(`${role}:tool_use:${block.id}`)
          } else if (block.type === 'tool_result' && 'tool_use_id' in block) {
            normalizedSeq.push(`${role}:tool_result:${block.tool_use_id}`)
          } else if (block.type === 'text') {
            normalizedSeq.push(`${role}:text`)
          } else if (block.type === 'thinking') {
            normalizedSeq.push(`${role}:thinking`)
          } else if (block.type === 'image') {
            normalizedSeq.push(`${role}:image`)
          } else {
            normalizedSeq.push(`${role}:${block.type}`)
          }
        }
      } else if (typeof content === 'string') {
        normalizedSeq.push(`${msg.message.role}:string_content`)
      }
    }

    // Build pre-normalized sequence
    const preNormalizedSeq: string[] = []
    for (let i = originalIndex + 1; i < messages.length; i++) {
      const msg = messages[i]
      if (!msg) continue

      switch (msg.type) {
        case 'user':
        case 'assistant': {
          if ('message' in msg) {
            const content = msg.message.content
            if (Array.isArray(content)) {
              for (const block of content) {
                const role = msg.message.role
                if (block.type === 'tool_use' && 'id' in block) {
                  preNormalizedSeq.push(`${role}:tool_use:${block.id}`)
                } else if (
                  block.type === 'tool_result' &&
                  'tool_use_id' in block
                ) {
                  preNormalizedSeq.push(
                    `${role}:tool_result:${block.tool_use_id}`,
                  )
                } else if (block.type === 'text') {
                  preNormalizedSeq.push(`${role}:text`)
                } else if (block.type === 'thinking') {
                  preNormalizedSeq.push(`${role}:thinking`)
                } else if (block.type === 'image') {
                  preNormalizedSeq.push(`${role}:image`)
                } else {
                  preNormalizedSeq.push(`${role}:${block.type}`)
                }
              }
            } else if (typeof content === 'string') {
              preNormalizedSeq.push(`${msg.message.role}:string_content`)
            }
          }
          break
        }
        case 'attachment':
          if ('attachment' in msg) {
            preNormalizedSeq.push(`attachment:${msg.attachment.type}`)
          }
          break
        case 'system':
          if ('subtype' in msg) {
            preNormalizedSeq.push(`system:${msg.subtype}`)
          }
          break
        case 'progress':
          if (
            'progress' in msg &&
            msg.progress &&
            typeof msg.progress === 'object' &&
            'type' in msg.progress
          ) {
            preNormalizedSeq.push(`progress:${msg.progress.type ?? 'unknown'}`)
          } else {
            preNormalizedSeq.push('progress:unknown')
          }
          break
      }
    }

    // Log to Statsig
    logEvent('tengu_tool_use_tool_result_mismatch_error', {
      toolUseId:
        toolUseId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      normalizedSequence: normalizedSeq.join(
        ', ',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      preNormalizedSequence: preNormalizedSeq.join(
        ', ',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      normalizedMessageCount: messagesForAPI.length,
      originalMessageCount: messages.length,
      normalizedToolUseIndex: normalizedIndex,
      originalToolUseIndex: originalIndex,
    })
  } catch (_) {
    // Ignore errors in debug logging
  }
}

/**
 * Type guard to check if a value is a valid Message response from the API
 */
export function isValidAPIMessage(value: unknown): value is BetaMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    'model' in value &&
    'usage' in value &&
    Array.isArray((value as BetaMessage).content) &&
    typeof (value as BetaMessage).model === 'string' &&
    typeof (value as BetaMessage).usage === 'object'
  )
}

/** Lower-level error that AWS can return. */
type AmazonError = {
  Output?: {
    __type?: string
  }
  Version?: string
}

/**
 * Given a response that doesn't look quite right, see if it contains any known error types we can extract.
 */
export function extractUnknownErrorFormat(value: unknown): string | undefined {
  // Check if value is a valid object first
  if (!value || typeof value !== 'object') {
    return undefined
  }

  // Amazon Bedrock routing errors
  if ((value as AmazonError).Output?.__type) {
    return (value as AmazonError).Output!.__type
  }

  return undefined
}

// 【核心设计：错误被转成一条「assistant 消息」，而不是抛出去】
//
//  返回类型是 AssistantMessage，内容是「模型说的话」，只是带了
//  isApiErrorMessage: true 标记。
//
//  为什么？三个后果，每一个都很重要：
//
//  1. **错误进入对话历史**。下一轮请求会把它带给模型，模型能看到
//     「上一轮我这边出错了」，从而调整（比如不再重复那个超大请求）。
//     如果只是 throw，模型永远不知道发生过什么。
//
//  2. **UI 不需要错误通道**。终端里「显示一条消息」和「显示一个错误」
//     走同一条渲染链，错误只是样式不同。少了一套并行的错误 UI。
//
//  3. **错误可以被压缩、被 /rewind、被持久化**。因为它就是消息，
//     所有对消息生效的机制自动对它生效。
//
//  代价是：错误和正常内容共用一套数据结构，所以必须有 isApiErrorMessage
//  这个标记，而且**每个消费方都要记得检查它**。这是这套设计的税。
//
//  下面这一长串 if 的顺序就是优先级 —— 先认最具体的（超时、图片校验），
//  再认状态码 + 文案组合，最后落到通用分支。改顺序会改变归类结果。
export function getAssistantMessageFromError(
  error: unknown,
  model: string,
  options?: {
    messages?: Message[]
    messagesForAPI?: (UserMessage | AssistantMessage)[]
  },
): AssistantMessage {
  // Check for SDK timeout errors
  if (
    error instanceof APIConnectionTimeoutError ||
    (error instanceof APIConnectionError &&
      error.message.toLowerCase().includes('timeout'))
  ) {
    return createAssistantAPIErrorMessage({
      content: API_TIMEOUT_ERROR_MESSAGE,
      error: 'unknown',
    })
  }

  // Check for image size/resize errors (thrown before API call during validation)
  // Use getImageTooLargeErrorMessage() to show "esc esc" hint for CLI users
  // but a generic message for SDK users (non-interactive mode)
  if (error instanceof ImageSizeError || error instanceof ImageResizeError) {
    return createAssistantAPIErrorMessage({
      content: getImageTooLargeErrorMessage(),
    })
  }

  // Check for emergency capacity off switch for Opus PAYG users
  if (
    error instanceof Error &&
    error.message.includes(CUSTOM_OFF_SWITCH_MESSAGE)
  ) {
    return createAssistantAPIErrorMessage({
      content: CUSTOM_OFF_SWITCH_MESSAGE,
      error: 'rate_limit',
    })
  }

//   // 【429 分两条完全不同的路，靠「有没有统一的限流头」区分】
//   //
//   //     有 anthropic-ratelimit-unified-* 头  →  是配额限制，能算出具体是哪一种、
//   //                                            什么时候恢复，给出精确文案
//   //     没有这些头                          →  不是配额限制，把 API 原话透出来
//   //
//   //  注释（第 537 行）把第二种说得很清楚：Entitlement rejections
//   //  (e.g. 1M context without Extra Usage) and infra capacity 429s land here.
//   //
//   //  也就是说 429 这个状态码被**过度复用**了：既表示「你超配额了」，
//   //  也表示「你套餐不支持这个功能」，还表示「我们这边容量不够」。
//   //  只能靠头来区分。
//   //
//   //  这是一个很典型的现实：**HTTP 状态码的语义比业务语义粗**。
//   //  所以凡是「状态码 + 响应头 + 文案」三层一起判断的地方，都别嫌它啰嗦。
  if (
    error instanceof APIError &&
    error.status === 429 &&
    shouldProcessRateLimits(isClaudeAISubscriber())
  ) {
    // Check if this is the new API with multiple rate limit headers
    const rateLimitType = error.headers?.get?.(
      'anthropic-ratelimit-unified-representative-claim',
    ) as 'five_hour' | 'seven_day' | 'seven_day_opus' | null

    const overageStatus = error.headers?.get?.(
      'anthropic-ratelimit-unified-overage-status',
    ) as 'allowed' | 'allowed_warning' | 'rejected' | null

    // If we have the new headers, use the new message generation
    if (rateLimitType || overageStatus) {
      // Build limits object from error headers to determine the appropriate message
      const limits: ClaudeAILimits = {
        status: 'rejected',
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      }

      // Extract rate limit information from headers
      const resetHeader = error.headers?.get?.(
        'anthropic-ratelimit-unified-reset',
      )
      if (resetHeader) {
        limits.resetsAt = Number(resetHeader)
      }

      if (rateLimitType) {
        limits.rateLimitType = rateLimitType
      }

      if (overageStatus) {
        limits.overageStatus = overageStatus
      }

      const overageResetHeader = error.headers?.get?.(
        'anthropic-ratelimit-unified-overage-reset',
      )
      if (overageResetHeader) {
        limits.overageResetsAt = Number(overageResetHeader)
      }

      const overageDisabledReason = error.headers?.get?.(
        'anthropic-ratelimit-unified-overage-disabled-reason',
      ) as OverageDisabledReason | null
      if (overageDisabledReason) {
        limits.overageDisabledReason = overageDisabledReason
      }

      // Use the new message format for all new API rate limits
      const specificErrorMessage = getRateLimitErrorMessage(limits, model)
      if (specificErrorMessage) {
        return createAssistantAPIErrorMessage({
          content: specificErrorMessage,
          error: 'rate_limit',
        })
      }

//       // 【返回 NO_RESPONSE_REQUESTED —— 一个「静默但有记录」的特殊值】
//       //
//       //  getRateLimitErrorMessage 返回 null 意味着：这次限流**会由降级机制
//       //  自动处理**（比如 Opus 满了自动换 Sonnet）。所以不该弹错误给用户。
//       //
//       //  但也不能什么都不返回 —— 注释说得很准确：
//       //
//       //      Return NO_RESPONSE_REQUESTED so no error is shown to the user,
//       //      but the message is still recorded in conversation history
//       //      for Claude to see.
//       //
//       //  两个需求同时满足：**用户看不见，模型看得见。**
//       //
//       //  这个技巧在整份源码里反复出现：一个特殊的内容值（不是 null、不是空串）
//       //  用来表达「这条消息存在，但不要显示」。第 62 行那个常量就是它的定义处。
//       //
//       //  判据：当你需要「记录但不显示」，不要用空内容（容易被过滤掉），
//       //  用一个可识别的哨兵值。
      // If getRateLimitErrorMessage returned null, it means the fallback mechanism
      // will handle this silently (e.g., Opus -> Sonnet fallback for eligible users).
      // Return NO_RESPONSE_REQUESTED so no error is shown to the user, but the
      // message is still recorded in conversation history for Claude to see.
      return createAssistantAPIErrorMessage({
        content: NO_RESPONSE_REQUESTED,
        error: 'rate_limit',
      })
    }

    // No quota headers — this is NOT a quota limit. Surface what the API actually
    // said instead of a generic "Rate limit reached". Entitlement rejections
    // (e.g. 1M context without Extra Usage) and infra capacity 429s land here.
    if (error.message.includes('Extra usage is required for long context')) {
      const hint = getIsNonInteractiveSession()
        ? 'enable extra usage at claude.ai/settings/usage, or use --model to switch to standard context'
        : 'run /extra-usage to enable, or /model to switch to standard context'
      return createAssistantAPIErrorMessage({
        content: `${API_ERROR_MESSAGE_PREFIX}: Extra usage is required for 1M context · ${hint}`,
        error: 'rate_limit',
      })
    }
    // SDK's APIError.makeMessage prepends "429 " and JSON-stringifies the body
    // when there's no top-level .message — extract the inner error.message.
    const stripped = error.message.replace(/^429\s+/, '')
    const innerMessage = stripped.match(/"message"\s*:\s*"([^"]*)"/)?.[1]
    const detail = innerMessage || stripped
    return createAssistantAPIErrorMessage({
      content: `${API_ERROR_MESSAGE_PREFIX}: Request rejected (429) · ${detail || 'this may be a temporary capacity issue — check status.anthropic.com'}`,
      error: 'rate_limit',
    })
  }

  // Handle prompt too long errors (Vertex returns 413, direct API returns 400)
  // Use case-insensitive check since Vertex returns "Prompt is too long" (capitalized)
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('prompt is too long')
  ) {
    // Content stays generic (UI matches on exact string). The raw error with
    // token counts goes into errorDetails — reactive compact's retry loop
    // parses the gap from there via getPromptTooLongTokenGap.
    return createAssistantAPIErrorMessage({
      content: PROMPT_TOO_LONG_ERROR_MESSAGE,
      error: 'invalid_request',
      errorDetails: error.message,
    })
  }

  // Check for PDF page limit errors
  if (
    error instanceof Error &&
    /maximum of \d+ PDF pages/.test(error.message)
  ) {
    return createAssistantAPIErrorMessage({
      content: getPdfTooLargeErrorMessage(),
      error: 'invalid_request',
      errorDetails: error.message,
    })
  }

  // Check for password-protected PDF errors
  if (
    error instanceof Error &&
    error.message.includes('The PDF specified is password protected')
  ) {
    return createAssistantAPIErrorMessage({
      content: getPdfPasswordProtectedErrorMessage(),
      error: 'invalid_request',
    })
  }

  // Check for invalid PDF errors (e.g., HTML file renamed to .pdf)
  // Without this handler, invalid PDF document blocks persist in conversation
  // context and cause every subsequent API call to fail with 400.
  if (
    error instanceof Error &&
    error.message.includes('The PDF specified was not valid')
  ) {
    return createAssistantAPIErrorMessage({
      content: getPdfInvalidErrorMessage(),
      error: 'invalid_request',
    })
  }

  // Check for image size errors (e.g., "image exceeds 5 MB maximum: 5316852 bytes > 5242880 bytes")
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('image exceeds') &&
    error.message.includes('maximum')
  ) {
    return createAssistantAPIErrorMessage({
      content: getImageTooLargeErrorMessage(),
      errorDetails: error.message,
    })
  }

  // Check for many-image dimension errors (API enforces stricter 2000px limit for many-image requests)
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('image dimensions exceed') &&
    error.message.includes('many-image')
  ) {
    return createAssistantAPIErrorMessage({
      content: getIsNonInteractiveSession()
        ? 'An image in the conversation exceeds the dimension limit for many-image requests (2000px). Start a new session with fewer images.'
        : 'An image in the conversation exceeds the dimension limit for many-image requests (2000px). Run /compact to remove old images from context, or start a new session.',
      error: 'invalid_request',
      errorDetails: error.message,
    })
  }

  // Server rejected the afk-mode beta header (plan does not include auto
  // mode). AFK_MODE_BETA_HEADER is '' in non-TRANSCRIPT_CLASSIFIER builds,
  // so the truthy guard keeps this inert there.
//   // 【`AFK_MODE_BETA_HEADER &&` 这个守卫，是构建期门控的运行时残留】
//   //
//   //  注释写明了：AFK_MODE_BETA_HEADER is '' in non-TRANSCRIPT_CLASSIFIER
//   //  builds, so the truthy guard keeps this inert there.
//   //
//   //  也就是说：在不开那个 feature 的构建里，这个常量被折成空字符串，
//   //  于是 `'' && ...` 恒假，整个 if 块永远不执行。
//   //
//   //  但注意 —— **代码还在包里**。这和上一批读到的 `false &&` 残留是同一类现象：
//   //  打包器做了常量折叠，没做死代码消除。
//   //
//   //  差别在于这里用的是**变量**（常量 import）而不是字面量 false，
//   //  所以折叠结果取决于跨模块的常量传播能力。能折成 `''` 说明打包器
//   //  确实做了跨模块的内联 —— 但依然没有删掉这个 if。
//   //
//   //  这也解释了为什么作者选择用「空字符串 + 真值守卫」而不是 feature() 包 if：
//   //  两种写法在产物里留下的东西差不多，而空字符串不需要额外 import。
  if (
    AFK_MODE_BETA_HEADER &&
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes(AFK_MODE_BETA_HEADER) &&
    error.message.includes('anthropic-beta')
  ) {
    return createAssistantAPIErrorMessage({
      content: 'Auto mode is unavailable for your plan',
      error: 'invalid_request',
    })
  }

  // Check for request too large errors (413 status)
  // This typically happens when a large PDF + conversation context exceeds the 32MB API limit
  if (error instanceof APIError && error.status === 413) {
    return createAssistantAPIErrorMessage({
      content: getRequestTooLargeErrorMessage(),
      error: 'invalid_request',
    })
  }

  // Check for tool_use/tool_result concurrency error
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes(
      '`tool_use` ids were found without `tool_result` blocks immediately after',
    )
  ) {
    // Log to Statsig if we have the message context
    if (options?.messages && options?.messagesForAPI) {
      const toolUseIdMatch = error.message.match(/toolu_[a-zA-Z0-9]+/)
      const toolUseId = toolUseIdMatch ? toolUseIdMatch[0] : null
      if (toolUseId) {
        logToolUseToolResultMismatch(
          toolUseId,
          options.messages,
          options.messagesForAPI,
        )
      }
    }

//     // 【内部用户和外部用户，两条完全不同的文案】
//     //
//     //  内部（USER_TYPE === 'ant'）：
//     //      API Error: 400 <原始 message>
//     //      Run /share and post the JSON file to <内部频道>。
//     //      然后用 /rewind 恢复。
//     //
//     //  外部：
//     //      API Error: 400 due to tool use concurrency issues.
//     //      Run /rewind to recover the conversation.
//     //
//     //  差别有两层：
//     //
//     //  1. 内部版把 API 的原始 message 透出来了 —— 外部用户看不懂，也不需要看
//     //  2. 内部版引导去 /share 上报，外部版只给恢复路径
//     //
//     //  这是「同一件事对不同人给不同信息量」的典型处理。注意它不是简单的
//     //  「藏信息」，而是**换了一套动作指引**：内部用户该做的是上报，
//     //  外部用户该做的是恢复。
//     //
//     //  顺带看 MACRO.FEEDBACK_CHANNEL：一个构建期替换的宏。
//     //  这就是为什么内部频道名不会出现在开源版本里。
    if (process.env.USER_TYPE === 'ant') {
      const baseMessage = `API Error: 400 ${error.message}\n\nRun /share and post the JSON file to ${MACRO.FEEDBACK_CHANNEL}.`
      const rewindInstruction = getIsNonInteractiveSession()
        ? ''
        : ' Then, use /rewind to recover the conversation.'
      return createAssistantAPIErrorMessage({
        content: baseMessage + rewindInstruction,
        error: 'invalid_request',
      })
    } else {
      const baseMessage = 'API Error: 400 due to tool use concurrency issues.'
      const rewindInstruction = getIsNonInteractiveSession()
        ? ''
        : ' Run /rewind to recover the conversation.'
      return createAssistantAPIErrorMessage({
        content: baseMessage + rewindInstruction,
        error: 'invalid_request',
      })
    }
  }

  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('unexpected `tool_use_id` found in `tool_result`')
  ) {
    logEvent('tengu_unexpected_tool_result', {})
  }

  // Duplicate tool_use IDs (CC-1212). ensureToolResultPairing strips these
  // before send, so hitting this means a new corruption path slipped through.
  // Log for root-causing, and give users a recovery path instead of deadlock.
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('`tool_use` ids must be unique')
  ) {
    logEvent('tengu_duplicate_tool_use_id', {})
    const rewindInstruction = getIsNonInteractiveSession()
      ? ''
      : ' Run /rewind to recover the conversation.'
    return createAssistantAPIErrorMessage({
      content: `API Error: 400 duplicate tool_use ID in conversation history.${rewindInstruction}`,
      error: 'invalid_request',
      errorDetails: error.message,
    })
  }

  // Check for invalid model name error for subscription users trying to use Opus
  if (
    isClaudeAISubscriber() &&
    error instanceof APIError &&
    error.status === 400 &&
    error.message.toLowerCase().includes('invalid model name') &&
    (isNonCustomOpusModel(model) || model === 'opus')
  ) {
    return createAssistantAPIErrorMessage({
      content:
        'Claude Opus is not available with the Claude Pro plan. If you have updated your subscription plan recently, run /logout and /login for the plan to take effect.',
      error: 'invalid_request',
    })
  }

  // Check for invalid model name error for Ant users. Claude Code may be
  // defaulting to a custom internal-only model for Ants, and there might be
  // Ants using new or unknown org IDs that haven't been gated in.
  if (
    process.env.USER_TYPE === 'ant' &&
    !process.env.ANTHROPIC_MODEL &&
    error instanceof Error &&
    error.message.toLowerCase().includes('invalid model name')
  ) {
    // Get organization ID from config - only use OAuth account data when actively using OAuth
    const orgId = getOauthAccountInfo()?.organizationUuid
    const baseMsg = `[ANT-ONLY] Your org isn't gated into the \`${model}\` model. Either run \`claude\` with \`ANTHROPIC_MODEL=${getDefaultMainLoopModelSetting()}\``
    const msg = orgId
      ? `${baseMsg} or share your orgId (${orgId}) in ${MACRO.FEEDBACK_CHANNEL} for help getting access.`
      : `${baseMsg} or reach out in ${MACRO.FEEDBACK_CHANNEL} for help getting access.`

    return createAssistantAPIErrorMessage({
      content: msg,
      error: 'invalid_request',
    })
  }

  if (
    error instanceof Error &&
    error.message.includes('Your credit balance is too low')
  ) {
    return createAssistantAPIErrorMessage({
      content: CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE,
      error: 'billing_error',
    })
  }
  // "Organization has been disabled" — commonly a stale ANTHROPIC_API_KEY
  // from a previous employer/project overriding subscription auth. Only handle
  // the env-var case; apiKeyHelper and /login-managed keys mean the active
  // auth's org is genuinely disabled with no dormant fallback to point at.
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.toLowerCase().includes('organization has been disabled')
  ) {
    const { source } = getAnthropicApiKeyWithSource()
    // getAnthropicApiKeyWithSource conflates the env var with FD-passed keys
    // under the same source value, and in CCR mode OAuth stays active despite
    // the env var. The three guards ensure we only blame the env var when it's
    // actually set and actually on the wire.
    if (
      source === 'ANTHROPIC_API_KEY' &&
      process.env.ANTHROPIC_API_KEY &&
      !isClaudeAISubscriber()
    ) {
      const hasStoredOAuth = getClaudeAIOAuthTokens()?.accessToken != null
      // Not 'authentication_failed' — that triggers VS Code's showLogin(), but
      // login can't fix this (approved env var keeps overriding OAuth). The fix
      // is configuration-based (unset the var), so invalid_request is correct.
      return createAssistantAPIErrorMessage({
        error: 'invalid_request',
        content: hasStoredOAuth
          ? ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH
          : ORG_DISABLED_ERROR_MESSAGE_ENV_KEY,
      })
    }
  }

  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('x-api-key')
  ) {
    // In CCR mode, auth is via JWTs - this is likely a transient network issue
    if (isCCRMode()) {
      return createAssistantAPIErrorMessage({
        error: 'authentication_failed',
        content: CCR_AUTH_ERROR_MESSAGE,
      })
    }

    // Check if the API key is from an external source
    const { source } = getAnthropicApiKeyWithSource()
    const isExternalSource =
      source === 'ANTHROPIC_API_KEY' || source === 'apiKeyHelper'

    return createAssistantAPIErrorMessage({
      error: 'authentication_failed',
      content: isExternalSource
        ? INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL
        : INVALID_API_KEY_ERROR_MESSAGE,
    })
  }

  // Check for OAuth token revocation error
  if (
    error instanceof APIError &&
    error.status === 403 &&
    error.message.includes('OAuth token has been revoked')
  ) {
    return createAssistantAPIErrorMessage({
      error: 'authentication_failed',
      content: getTokenRevokedErrorMessage(),
    })
  }

  // Check for OAuth organization not allowed error
  if (
    error instanceof APIError &&
    (error.status === 401 || error.status === 403) &&
    error.message.includes(
      'OAuth authentication is currently not allowed for this organization',
    )
  ) {
    return createAssistantAPIErrorMessage({
      error: 'authentication_failed',
      content: getOauthOrgNotAllowedErrorMessage(),
    })
  }

  // Generic handler for other 401/403 authentication errors
  if (
    error instanceof APIError &&
    (error.status === 401 || error.status === 403)
  ) {
    // In CCR mode, auth is via JWTs - this is likely a transient network issue
    if (isCCRMode()) {
      return createAssistantAPIErrorMessage({
        error: 'authentication_failed',
        content: CCR_AUTH_ERROR_MESSAGE,
      })
    }

    return createAssistantAPIErrorMessage({
      error: 'authentication_failed',
      content: getIsNonInteractiveSession()
        ? `Failed to authenticate. ${API_ERROR_MESSAGE_PREFIX}: ${error.message}`
        : `Please run /login · ${API_ERROR_MESSAGE_PREFIX}: ${error.message}`,
    })
  }

  // Bedrock errors like "403 You don't have access to the model with the specified model ID."
  // don't contain the actual model ID
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) &&
    error instanceof Error &&
    error.message.toLowerCase().includes('model id')
  ) {
    const switchCmd = getIsNonInteractiveSession() ? '--model' : '/model'
    const fallbackSuggestion = get3PModelFallbackSuggestion(model)
    return createAssistantAPIErrorMessage({
      content: fallbackSuggestion
        ? `${API_ERROR_MESSAGE_PREFIX} (${model}): ${error.message}. Try ${switchCmd} to switch to ${fallbackSuggestion}.`
        : `${API_ERROR_MESSAGE_PREFIX} (${model}): ${error.message}. Run ${switchCmd} to pick a different model.`,
      error: 'invalid_request',
    })
  }

  // 404 Not Found — usually means the selected model doesn't exist or isn't
  // available. Guide the user to /model so they can pick a valid one.
  // For 3P users, suggest a specific fallback model they can try.
  if (error instanceof APIError && error.status === 404) {
    const switchCmd = getIsNonInteractiveSession() ? '--model' : '/model'
    const fallbackSuggestion = get3PModelFallbackSuggestion(model)
    return createAssistantAPIErrorMessage({
      content: fallbackSuggestion
        ? `The model ${model} is not available on your ${getAPIProvider()} deployment. Try ${switchCmd} to switch to ${fallbackSuggestion}, or ask your admin to enable this model.`
        : `There's an issue with the selected model (${model}). It may not exist or you may not have access to it. Run ${switchCmd} to pick a different model.`,
      error: 'invalid_request',
    })
  }

  // Connection errors (non-timeout) — use formatAPIError for detailed messages
  if (error instanceof APIConnectionError) {
    return createAssistantAPIErrorMessage({
      content: `${API_ERROR_MESSAGE_PREFIX}: ${formatAPIError(error)}`,
      error: 'unknown',
    })
  }

  if (error instanceof Error) {
    return createAssistantAPIErrorMessage({
      content: `${API_ERROR_MESSAGE_PREFIX}: ${error.message}`,
      error: 'unknown',
    })
  }
  return createAssistantAPIErrorMessage({
    content: API_ERROR_MESSAGE_PREFIX,
    error: 'unknown',
  })
}

/**
 * For 3P users, suggest a fallback model when the selected model is unavailable.
 * Returns a model name suggestion, or undefined if no suggestion is applicable.
 */
// 【`@[MODEL LAUNCH]` —— 一个给「发新模型时」用的待办标记】
//
//  注释原文：@[MODEL LAUNCH]: Add a fallback suggestion chain for the new
//  model → previous version for 3P.
//
//  这个标记在仓库里是**可搜索的待办**：发新模型时要来这里加一条降级建议。
//  比 TODO 好的地方是它带了一个可 grep 的精确前缀，而且语义明确
//  （不是「以后可能要做」，是「发版流程的一步」）。
//
//  函数本身只对第三方 provider 生效（第 941 行 firstParty 直接返回 undefined），
//  因为官方 API 上新模型和旧模型同时在线，不需要建议降级；
//  而 Bedrock/Vertex 上新有延迟，用户选了还没上线的模型就会 404。
//
//  所以这里的三条 if 就是「新模型 → 上一个可用版本」的映射表。
//  注意匹配用的是 includes 而且同时匹配连字符和下划线两种写法 ——
//  因为不同 provider 的模型 ID 命名规范不同。
function get3PModelFallbackSuggestion(model: string): string | undefined {
  if (getAPIProvider() === 'firstParty') {
    return undefined
  }
  // @[MODEL LAUNCH]: Add a fallback suggestion chain for the new model → previous version for 3P
  const m = model.toLowerCase()
  // If the failing model looks like an Opus 4.6 variant, suggest the default Opus (4.1 for 3P)
  if (m.includes('opus-4-6') || m.includes('opus_4_6')) {
    return getModelStrings().opus41
  }
  // If the failing model looks like a Sonnet 4.6 variant, suggest Sonnet 4.5
  if (m.includes('sonnet-4-6') || m.includes('sonnet_4_6')) {
    return getModelStrings().sonnet45
  }
  // If the failing model looks like a Sonnet 4.5 variant, suggest Sonnet 4
  if (m.includes('sonnet-4-5') || m.includes('sonnet_4_5')) {
    return getModelStrings().sonnet40
  }
  return undefined
}

/**
 * Classifies an API error into a specific error type for analytics tracking.
 * Returns a standardized error type string suitable for Datadog tagging.
 */
export function classifyAPIError(error: unknown): string {
  // Aborted requests
  if (error instanceof Error && error.message === 'Request was aborted.') {
    return 'aborted'
  }

  // Timeout errors
  if (
    error instanceof APIConnectionTimeoutError ||
    (error instanceof APIConnectionError &&
      error.message.toLowerCase().includes('timeout'))
  ) {
    return 'api_timeout'
  }

  // Check for repeated 529 errors
  if (
    error instanceof Error &&
    error.message.includes(REPEATED_529_ERROR_MESSAGE)
  ) {
    return 'repeated_529'
  }

  // Check for emergency capacity off switch
  if (
    error instanceof Error &&
    error.message.includes(CUSTOM_OFF_SWITCH_MESSAGE)
  ) {
    return 'capacity_off_switch'
  }

  // Rate limiting
  if (error instanceof APIError && error.status === 429) {
    return 'rate_limit'
  }

  // Server overload (529)
  if (
    error instanceof APIError &&
    (error.status === 529 ||
      error.message?.includes('"type":"overloaded_error"'))
  ) {
    return 'server_overload'
  }

  // Prompt/content size errors
  if (
    error instanceof Error &&
    error.message
      .toLowerCase()
      .includes(PROMPT_TOO_LONG_ERROR_MESSAGE.toLowerCase())
  ) {
    return 'prompt_too_long'
  }

  // PDF errors
  if (
    error instanceof Error &&
    /maximum of \d+ PDF pages/.test(error.message)
  ) {
    return 'pdf_too_large'
  }

  if (
    error instanceof Error &&
    error.message.includes('The PDF specified is password protected')
  ) {
    return 'pdf_password_protected'
  }

  // Image size errors
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('image exceeds') &&
    error.message.includes('maximum')
  ) {
    return 'image_too_large'
  }

  // Many-image dimension errors
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('image dimensions exceed') &&
    error.message.includes('many-image')
  ) {
    return 'image_too_large'
  }

  // Tool use errors (400)
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes(
      '`tool_use` ids were found without `tool_result` blocks immediately after',
    )
  ) {
    return 'tool_use_mismatch'
  }

  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('unexpected `tool_use_id` found in `tool_result`')
  ) {
    return 'unexpected_tool_result'
  }

  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('`tool_use` ids must be unique')
  ) {
    return 'duplicate_tool_use_id'
  }

  // Invalid model errors (400)
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.toLowerCase().includes('invalid model name')
  ) {
    return 'invalid_model'
  }

  // Credit/billing errors
  if (
    error instanceof Error &&
    error.message
      .toLowerCase()
      .includes(CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE.toLowerCase())
  ) {
    return 'credit_balance_low'
  }

  // Authentication errors
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('x-api-key')
  ) {
    return 'invalid_api_key'
  }

  if (
    error instanceof APIError &&
    error.status === 403 &&
    error.message.includes('OAuth token has been revoked')
  ) {
    return 'token_revoked'
  }

  if (
    error instanceof APIError &&
    (error.status === 401 || error.status === 403) &&
    error.message.includes(
      'OAuth authentication is currently not allowed for this organization',
    )
  ) {
    return 'oauth_org_not_allowed'
  }

  // Generic auth errors
  if (
    error instanceof APIError &&
    (error.status === 401 || error.status === 403)
  ) {
    return 'auth_error'
  }

  // Bedrock-specific errors
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) &&
    error instanceof Error &&
    error.message.toLowerCase().includes('model id')
  ) {
    return 'bedrock_model_access'
  }

  // Status code based fallbacks
  if (error instanceof APIError) {
    const status = error.status
    if (status >= 500) return 'server_error'
    if (status >= 400) return 'client_error'
  }

  // Connection errors - check for SSL/TLS issues first
  if (error instanceof APIConnectionError) {
    const connectionDetails = extractConnectionErrorDetails(error)
    if (connectionDetails?.isSSLError) {
      return 'ssl_cert_error'
    }
    return 'connection_error'
  }

  return 'unknown'
}

// 【categorizeRetryableAPIError：只判状态码，和上面那个函数分工明确】
//
//  两个分类函数的区别值得记住：
//
//      classifyAPIError              给埋点用，认得几十种具体错误（含文案匹配）
//      categorizeRetryableAPIError   给重试决策用，只看状态码
//
//  为什么重试决策不需要那么细？因为重试逻辑只关心一件事：
//  **再试一次有没有意义。** 而这件事基本由状态码决定：
//
//      529 / overloaded  → 服务端过载，等一会儿再试 ✓
//      429               → 限流，退避后重试 ✓
//      401 / 403         → 认证问题，重试多少次都一样 ✗
//      >= 408            → 服务端/网络类，可以试
//      其他              → unknown（由上层决定）
//
//  注意 529 被归到 rate_limit 而不是单独一类 —— 因为对重试策略来说，
//  它们的处理完全一样（指数退避）。**分类的粒度由消费方决定，
//  做同一个次就够了。**
//
//  这也解释了为什么状态码 >= 408 就归 server_error：4xx 里的 400/404/413
//  是「你的请求有问题」，408（超时）和 5xx 才是「服务端/链路的问题」。
export function categorizeRetryableAPIError(
  error: APIError,
): SDKAssistantMessageError {
  if (
    error.status === 529 ||
    error.message?.includes('"type":"overloaded_error"')
  ) {
    return 'rate_limit'
  }
  if (error.status === 429) {
    return 'rate_limit'
  }
  if (error.status === 401 || error.status === 403) {
    return 'authentication_failed'
  }
  if (error.status !== undefined && error.status >= 408) {
    return 'server_error'
  }
  return 'unknown'
}

// 【refusal 不是错误，是模型的一次正常回答 —— 但要好心处理】
//
//  模型可以选择「拒绝回答」（stop_reason === 'refusal'）。这在协议上是
//  一次成功的响应，不是 HTTP 错误。所以这个函数接的是 stopReason
//  而不是 error。
//
//  它做了三件事：
//
//      1. 埋点（tengu_refusal_api_response）—— 用来观察拒绝率
//      2. 一句解释 + 用法政策链接，并给出「改一下说法」的建议
//      3. 如果当前不是 Sonnet，建议切到 Sonnet 再试
//
//  第 3 条很有意思：**换模型也是一种「改说法」**。不同模型对同一边界请求的
//  判定不完全一致，所以换一个模型可能就过了。
//
//  注意它对模型名的比较是硬编码字面量 'claude-sonnet-4-20250514'，
//  而不是走 getModelStrings()。这和本目录其他地方的做法不一致 ——
//  属于「历史遗留 + 懒得改」，读到不用深究，但要知道这是个例外。
export function getErrorMessageIfRefusal(
  stopReason: BetaStopReason | null,
  model: string,
): AssistantMessage | undefined {
  if (stopReason !== 'refusal') {
    return
  }

  logEvent('tengu_refusal_api_response', {})

  const baseMessage = getIsNonInteractiveSession()
    ? `${API_ERROR_MESSAGE_PREFIX}: Claude Code is unable to respond to this request, which appears to violate our Usage Policy (https://www.anthropic.com/legal/aup). Try rephrasing the request or attempting a different approach.`
    : `${API_ERROR_MESSAGE_PREFIX}: Claude Code is unable to respond to this request, which appears to violate our Usage Policy (https://www.anthropic.com/legal/aup). Please double press esc to edit your last message or start a new session for Claude Code to assist with a different task.`

  const modelSuggestion =
    model !== 'claude-sonnet-4-20250514'
      ? ' If you are seeing this refusal repeatedly, try running /model claude-sonnet-4-20250514 to switch models.'
      : ''

  return createAssistantAPIErrorMessage({
    content: baseMessage + modelSuggestion,
    error: 'invalid_request',
  })
}
