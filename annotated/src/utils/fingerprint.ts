// 会话指纹计算，用于归因标识。算法很短但契约很硬：三条输入（盐、首条用户消息里固定三个位置上的字符、版本号）拼起来做 SHA256 取前三位十六进制。盐必须与后端校验方完全一致，算法也不可随意改动。
import { createHash } from 'crypto'
import type { AssistantMessage, UserMessage } from '../types/message.js'

/**
 * Hardcoded salt from backend validation.
 * Must match exactly for fingerprint validation to pass.
 */
export const FINGERPRINT_SALT = '59cf53e54c78'
// 盐是硬编码的常量，注释点明它来自后端校验约定：前后端要算出同一个结果，这个值就必须逐字一致，不能按环境改写。

/**
 * Extracts text content from the first user message.
 *
 * @param messages - Array of internal message types
 * @returns First text content, or empty string if not found
 */
export function extractFirstMessageText(
  messages: (UserMessage | AssistantMessage)[],
): string {
  const firstUserMessage = messages.find(msg => msg.type === 'user')
  if (!firstUserMessage) {
    return ''
  }

  const content = firstUserMessage.message.content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const textBlock = content.find(block => block.type === 'text')
    if (textBlock && textBlock.type === 'text') {
      return textBlock.text
    }
  }

  return ''
}
// 取文本时先找第一条用户消息，没有就返回空串；内容是字符串则直接用，是数组则找第一个文本块。逐层降级而不是假定形状，因为消息内容在内部表示里既可能是纯串也可能是块数组。

/**
 * Computes 3-character fingerprint for Claude Code attribution.
 * Algorithm: SHA256(SALT + msg[4] + msg[7] + msg[20] + version)[:3]
 * IMPORTANT: Do not change this method without careful coordination with
 * 1P and 3P (Bedrock, Vertex, Azure) APIs.
 *
 * @param messageText - First user message text content
 * @param version - Version string (from MACRO.VERSION)
 * @returns 3-character hex fingerprint
 */
export function computeFingerprint(
  messageText: string,
  version: string,
): string {
  // Extract chars at indices [4, 7, 20], use "0" if index not found
  const indices = [4, 7, 20]
  const chars = indices.map(i => messageText[i] || '0').join('')

  const fingerprintInput = `${FINGERPRINT_SALT}${chars}${version}`

  // SHA256 hash, return first 3 hex chars
  const hash = createHash('sha256').update(fingerprintInput).digest('hex')
  return hash.slice(0, 3)
}
// 三个下标是约定的偏移量，越界时用字符零补位，保证无论消息多短都能凑出三位输入。拼接顺序是盐、字符、版本，任何一段换位置都会改变结果。最后取六十四个十六进制字符里的前三个。

/**
 * Computes fingerprint from the first user message.
 *
 * @param messages - Array of normalized messages
 * @returns 3-character hex fingerprint
 */
export function computeFingerprintFromMessages(
  messages: (UserMessage | AssistantMessage)[],
): string {
  const firstMessageText = extractFirstMessageText(messages)
  return computeFingerprint(firstMessageText, MACRO.VERSION)
}
// 对外的便捷入口把取文本与计算串起来，版本号从构建期注入的全局常量读。注释两次强调改动要协调三方 API——这是个一旦发布就几乎不能改的隐性协议。
