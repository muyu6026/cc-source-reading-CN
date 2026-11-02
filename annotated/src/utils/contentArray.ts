/**
 * Utility for inserting a block into a content array relative to tool_result
 * blocks. Used by the API layer to position supplementary content (e.g.,
 * cache editing directives) correctly within user messages.
 *
 * Placement rules:
 * - If tool_result blocks exist: insert after the last one
 * - Otherwise: insert before the last block
 * - If the inserted block would be the final element, a text continuation
 *   block is appended (some APIs require the prompt not to end with
 *   non-text content)
 */
// 文件级工具：在 content 数组里、相对 tool_result 块的位置插入补充块（例如 API 层用来把缓存编辑指令放到用户消息里的正确位置）。

/**
 * Inserts a block into the content array after the last tool_result block.
 * Mutates the array in place.
 *
 * @param content - The content array to modify
 * @param block - The block to insert
 */
// 把补充块插到最后一个 tool_result 块之后，原地改写数组（不返回新数组）。
export function insertBlockAfterToolResults(
  content: unknown[],
  block: unknown,
): void {
  // Find position after the last tool_result block
  let lastToolResultIndex = -1
  for (let i = 0; i < content.length; i++) {
    const item = content[i]
    if (
      item &&
      typeof item === 'object' &&
      'type' in item &&
      (item as { type: string }).type === 'tool_result'
    ) {
      lastToolResultIndex = i
    }
  }

  if (lastToolResultIndex >= 0) {
    const insertPos = lastToolResultIndex + 1
    content.splice(insertPos, 0, block)
// 核心插入：用 splice 在 lastToolResultIndex + 1 处插入 block；若插入后它成了数组末尾，再补一个 text 续接块（部分 API 不允许 prompt 以非文本结尾）。
    // Append a text continuation if the inserted block is now last
    if (insertPos === content.length - 1) {
      content.push({ type: 'text', text: '.' })
    }
  } else {
    // No tool_result blocks — insert before the last block
    const insertIndex = Math.max(0, content.length - 1)
    content.splice(insertIndex, 0, block)
  }
}
// 无 tool_result 时的兜底：插到倒数第二的位置（Math.max(0, length-1)），保证不会插到最末尾。
