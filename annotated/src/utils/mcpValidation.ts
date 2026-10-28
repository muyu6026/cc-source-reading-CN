import type {
  ContentBlockParam,
  ImageBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  countMessagesTokensWithAPI,
  roughTokenCountEstimation,
} from '../services/tokenEstimation.js'
import { compressImageBlock } from './imageResizer.js'
import { logError } from './log.js'

export const MCP_TOKEN_COUNT_THRESHOLD_FACTOR = 0.5
// 触发真实 token 计数的阈值系数：估算不超过上限的 50% 就假定无需截断，省去 API 调用。
export const IMAGE_TOKEN_ESTIMATE = 1600
// 单张图片按 1600 token 估算（不实际计费，仅用于预算）。
const DEFAULT_MAX_MCP_OUTPUT_TOKENS = 25000

/**
 * Resolve the MCP output token cap. Precedence:
 *   1. MAX_MCP_OUTPUT_TOKENS env var (explicit user override)
 *   2. tengu_satin_quoll GrowthBook flag's `mcp_tool` key (tokens, not chars —
 *      unlike the other keys in that map which getPersistenceThreshold reads
 *      as chars; MCP has its own truncation layer upstream of that)
 *   3. Hardcoded default
 */
export function getMaxMcpOutputTokens(): number {
// getMaxMcpOutputTokens：优先级 env 变量 > tengu_satin_quoll 的 mcp_tool 键 > 硬编码默认 25000。
  const envValue = process.env.MAX_MCP_OUTPUT_TOKENS
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  const overrides = getFeatureValue_CACHED_MAY_BE_STALE<Record<
    string,
    number
  > | null>('tengu_satin_quoll', {})
  const override = overrides?.['mcp_tool']
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override > 0
  ) {
    return override
  }
  return DEFAULT_MAX_MCP_OUTPUT_TOKENS
}

export type MCPToolResult = string | ContentBlockParam[] | undefined
// MCPToolResult：工具结果可以是纯字符串、内容块数组或 undefined。

function isTextBlock(block: ContentBlockParam): block is TextBlockParam {
  return block.type === 'text'
}

function isImageBlock(block: ContentBlockParam): block is ImageBlockParam {
  return block.type === 'image'
}

export function getContentSizeEstimate(content: MCPToolResult): number {
// getContentSizeEstimate：字符串按粗略 token 估算，内容块逐个累加（图片按 1600 计）。
  if (!content) return 0

  if (typeof content === 'string') {
    return roughTokenCountEstimation(content)
  }

  return content.reduce((total, block) => {
    if (isTextBlock(block)) {
      return total + roughTokenCountEstimation(block.text)
    } else if (isImageBlock(block)) {
      // Estimate for image tokens
      return total + IMAGE_TOKEN_ESTIMATE
    }
    return total
  }, 0)
}

function getMaxMcpOutputChars(): number {
// getMaxMcpOutputChars：token 上限乘 4 换算成字符预算（MCP 自有截断层，按字符计）。
  return getMaxMcpOutputTokens() * 4
}

function getTruncationMessage(): string {
// getTruncationMessage：超量时附带的输出已截断提示，引导用户用分页或过滤工具取具体数据。
  return `\n\n[OUTPUT TRUNCATED - exceeded ${getMaxMcpOutputTokens()} token limit]

The tool output was truncated. If this MCP server provides pagination or filtering tools, use them to retrieve specific portions of the data. If pagination is not available, inform the user that you are working with truncated output and results may be incomplete.`
}

function truncateString(content: string, maxChars: number): string {
// truncateString：未超预算原样返回，否则按 maxChars 切片。
  if (content.length <= maxChars) {
    return content
  }
  return content.slice(0, maxChars)
}

async function truncateContentBlocks(
  blocks: ContentBlockParam[],
  maxChars: number,
): Promise<ContentBlockParam[]> {
// truncateContentBlocks：按字符预算贪心保留文本块；图片超预算时尝试压缩以塞进剩余空间，压缩失败就跳过。
  const result: ContentBlockParam[] = []
  let currentChars = 0

  for (const block of blocks) {
    if (isTextBlock(block)) {
      const remainingChars = maxChars - currentChars
      if (remainingChars <= 0) break

      if (block.text.length <= remainingChars) {
        result.push(block)
        currentChars += block.text.length
      } else {
        result.push({ type: 'text', text: block.text.slice(0, remainingChars) })
        break
      }
    } else if (isImageBlock(block)) {
      // Include images but count their estimated size
      const imageChars = IMAGE_TOKEN_ESTIMATE * 4
      if (currentChars + imageChars <= maxChars) {
        result.push(block)
        currentChars += imageChars
      } else {
        // Image exceeds budget - try to compress it to fit remaining space
        const remainingChars = maxChars - currentChars
        if (remainingChars > 0) {
          // Convert remaining chars to bytes for compression
          // base64 uses ~4/3 the original size, so we calculate max bytes
          const remainingBytes = Math.floor(remainingChars * 0.75)
          try {
            const compressedBlock = await compressImageBlock(
              block,
              remainingBytes,
            )
            result.push(compressedBlock)
            // Update currentChars based on compressed image size
            if (compressedBlock.source.type === 'base64') {
              currentChars += compressedBlock.source.data.length
            } else {
              currentChars += imageChars
            }
          } catch {
            // If compression fails, skip the image
          }
        }
      }
    } else {
      result.push(block)
    }
  }

  return result
}

export async function mcpContentNeedsTruncation(
  content: MCPToolResult,
): Promise<boolean> {
// mcpContentNeedsTruncation：先用大小估算做启发式，确需再调 token 计数 API；出错则假定不截断。
  if (!content) return false

  // Use size check as a heuristic to avoid unnecessary token counting API calls
  const contentSizeEstimate = getContentSizeEstimate(content)
  if (
    contentSizeEstimate <=
    getMaxMcpOutputTokens() * MCP_TOKEN_COUNT_THRESHOLD_FACTOR
  ) {
    return false
  }

  try {
    const messages =
      typeof content === 'string'
        ? [{ role: 'user' as const, content }]
        : [{ role: 'user' as const, content }]

    const tokenCount = await countMessagesTokensWithAPI(messages, [])
    return !!(tokenCount && tokenCount > getMaxMcpOutputTokens())
  } catch (error) {
    logError(error)
    // Assume no truncation needed on error
    return false
  }
}

export async function truncateMcpContent(
  content: MCPToolResult,
): Promise<MCPToolResult> {
// truncateMcpContent：字符串切片后补截断提示；内容块则截断后在末尾追加一条提示块。
  if (!content) return content

  const maxChars = getMaxMcpOutputChars()
  const truncationMsg = getTruncationMessage()

  if (typeof content === 'string') {
    return truncateString(content, maxChars) + truncationMsg
  } else {
    const truncatedBlocks = await truncateContentBlocks(
      content as ContentBlockParam[],
      maxChars,
    )
    truncatedBlocks.push({ type: 'text', text: truncationMsg })
    return truncatedBlocks
  }
}

export async function truncateMcpContentIfNeeded(
  content: MCPToolResult,
): Promise<MCPToolResult> {
// truncateMcpContentIfNeeded：仅在判定需要截断时才真正截断（门控函数）。
  if (!(await mcpContentNeedsTruncation(content))) {
    return content
  }

  return await truncateMcpContent(content)
}
