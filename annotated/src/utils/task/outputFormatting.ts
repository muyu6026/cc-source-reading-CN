// 本文件负责「任务输出」的格式化与截断：把工具或任务产生的长文本裁剪成 API 可消费的体量，超出上限时附上完整文件路径供后续查阅。
import { validateBoundedIntEnvVar } from '../envValidation.js'
import { getTaskOutputPath } from './diskOutput.js'

// TASK_MAX_OUTPUT_UPPER_LIMIT 与 TASK_MAX_OUTPUT_DEFAULT：任务输出长度的上限与默认值（分别为 160000 与 32000 字符）。
export const TASK_MAX_OUTPUT_UPPER_LIMIT = 160_000
export const TASK_MAX_OUTPUT_DEFAULT = 32_000

// getMaxTaskOutputLength：读取 TASK_MAX_OUTPUT_LENGTH 环境变量，经有界整数校验后返回当前生效的最大输出长度。
export function getMaxTaskOutputLength(): number {
  const result = validateBoundedIntEnvVar(
    'TASK_MAX_OUTPUT_LENGTH',
    process.env.TASK_MAX_OUTPUT_LENGTH,
    TASK_MAX_OUTPUT_DEFAULT,
    TASK_MAX_OUTPUT_UPPER_LIMIT,
  )
  return result.effective
}

/**
 * Format task output for API consumption, truncating if too large.
 * When truncated, includes a header with the file path and returns
 * the last N characters that fit within the limit.
 */
// formatTaskOutput：若输出未超上限则原样返回；超限则保留末尾 availableSpace 字符，并在头部加上「完整输出位于 filePath」的提示，标记 wasTruncated 为 true。
export function formatTaskOutput(
  output: string,
  taskId: string,
): { content: string; wasTruncated: boolean } {
  const maxLen = getMaxTaskOutputLength()

  if (output.length <= maxLen) {
    return { content: output, wasTruncated: false }
  }

  const filePath = getTaskOutputPath(taskId)
  const header = `[Truncated. Full output: ${filePath}]\n\n`
  const availableSpace = maxLen - header.length
  const truncated = output.slice(-availableSpace)

  return { content: header + truncated, wasTruncated: true }
}
