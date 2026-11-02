// 本文件是「基于分类器的权限系统」共享基础设施：为 bashClassifier（语义化 Bash 命令匹配）与 yoloClassifier（YOLO 模式安全分类）提供共用的类型、zod 校验器与工具函数。模块本身不依赖具体分类器实现。
/**
 * Shared infrastructure for classifier-based permission systems.
 *
 * This module provides common types, schemas, and utilities used by both:
 * - bashClassifier.ts (semantic Bash command matching)
 * - yoloClassifier.ts (YOLO mode security classification)
 */

import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages.js'
import type { z } from 'zod/v4'

/**
 * Extract tool use block from message content by tool name.
 */
// extractToolUseBlock：从消息内容数组中按工具名查找并返回对应的工具调用块（tool_use）。找不到或类型不符时返回 null。
export function extractToolUseBlock(
  content: BetaContentBlock[],
  toolName: string,
): Extract<BetaContentBlock, { type: 'tool_use' }> | null {
  const block = content.find(b => b.type === 'tool_use' && b.name === toolName)
  if (!block || block.type !== 'tool_use') {
    return null
  }
  return block
}

/**
 * Parse and validate classifier response from tool use block.
 * Returns null if parsing fails.
 */
// parseClassifierResponse：用给定 zod schema 安全解析工具调用块的输入字段。解析失败时返回 null，调用方据此回退到默认分类逻辑。
export function parseClassifierResponse<T extends z.ZodTypeAny>(
  toolUseBlock: Extract<BetaContentBlock, { type: 'tool_use' }>,
  schema: T,
): z.infer<T> | null {
  const parseResult = schema.safeParse(toolUseBlock.input)
  if (!parseResult.success) {
    return null
  }
  return parseResult.data
}
