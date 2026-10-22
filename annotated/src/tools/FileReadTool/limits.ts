/**
 * Read tool output limits.  Two caps apply to text reads:
 *
 *   | limit         | default | checks                    | cost          | on overflow     |
 *   |---------------|---------|---------------------------|---------------|-----------------|
 *   | maxSizeBytes  | 256 KB  | TOTAL FILE SIZE (not out) | 1 stat        | throws pre-read |
 *   | maxTokens     | 25000   | actual output tokens      | API roundtrip | throws post-read|
 *
 * Known mismatch: maxSizeBytes gates on total file size, not the slice.
 * Tested truncating instead of throwing for explicit-limit reads that
 * exceed the byte cap (#21841, Mar 2026).  Reverted: tool error rate
 * dropped but mean tokens rose — the throw path yields a ~100-byte error
 * tool-result while truncation yields ~25K tokens of content at the cap.
 */
// 文件头的注释就是**全篇的规格说明**，一张表把两个上限讲透了。`maxSizeBytes`（默认 256KB）卡的是**整个文件大小而不是本次输出的切片**，成本只有一次 `stat`，在**读之前**就抛错；`maxTokens`（默认 25,000）卡的是**实际输出 token**，成本是一次 API 往返，在**读之后**才抛错。两个上限管的是不同的东西：一个防「文件太大读不动」，一个防「读出来塞不进上下文」。
import memoize from 'lodash-es/memoize.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { MAX_OUTPUT_SIZE } from 'src/utils/file.js'
export const DEFAULT_MAX_OUTPUT_TOKENS = 25000
// 默认 25,000 token，大约是上下文窗口的十分之一多一点。这个数的意义在于：一次 Read 最多吃掉十分之一窗口，模型还能留出空间做别的。注意它和 `maxSizeBytes` 是**独立**的，不换算关系 —— 一个偏大的 JSON 文件可能只有 300KB 但压缩率极低，字节没超但 token 超了。

/**
 * Env var override for max output tokens. Returns undefined when unset/invalid
 * so the caller can fall through to the next precedence tier.
 */
function getEnvMaxTokens(): number | undefined {
  const override = process.env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS
  if (override) {
    const parsed = parseInt(override, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  return undefined
}
// 环境变量覆盖**优先级最高**，注释说明了理由：这是用户手动设的，应该压过实验平台下发的值。返回 `undefined` 而不是 `null` 或 0，是为了让调用方能干净地用 `??` 落到下一档 —— 用 0 当哨兵值的话，一个手滑写成 `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=0` 就会让所有读取都超限。`parseInt` 失败或非正数一律当没设。

export type FileReadingLimits = {
  maxTokens: number
  maxSizeBytes: number
  includeMaxSizeInPrompt?: boolean
  targetedRangeNudge?: boolean
}

/**
 * Default limits for Read tool when the ToolUseContext doesn't supply an
 * override. Memoized so the GrowthBook value is fixed at first call — avoids
 * the cap changing mid-session as the flag refreshes in the background.
 *
 * Precedence for maxTokens: env var > GrowthBook > DEFAULT_MAX_OUTPUT_TOKENS.
 * (Env var is a user-set override, should beat experiment infrastructure.)
 *
 * Defensive: each field is individually validated; invalid values fall
 * through to the hardcoded defaults (no route to cap=0).
 */
// `memoize` 在这里不是为了性能，是为了**值稳定**：GrowthBook 的缓存值会在后台刷新，如果不冻结，同一个会话里 Read 的上限可能中途从 25,000 变成 30,000。后果是 prompt 里写的上限和实际生效的不一致（`includeMaxSizeInPrompt` 会把数字念给模型听），而且行为不可复现。所以第一次调用就把值钉死。
export const getDefaultFileReadingLimits = memoize((): FileReadingLimits => {
  const override =
    getFeatureValue_CACHED_MAY_BE_STALE<Partial<FileReadingLimits> | null>(
      'tengu_amber_wren',
      {},
    )

  const maxSizeBytes =
    typeof override?.maxSizeBytes === 'number' &&
    Number.isFinite(override.maxSizeBytes) &&
    override.maxSizeBytes > 0
      ? override.maxSizeBytes
      : MAX_OUTPUT_SIZE

  const envMaxTokens = getEnvMaxTokens()
  const maxTokens =
    envMaxTokens ??
    (typeof override?.maxTokens === 'number' &&
    Number.isFinite(override.maxTokens) &&
    override.maxTokens > 0
      ? override.maxTokens
      : DEFAULT_MAX_OUTPUT_TOKENS)

  const includeMaxSizeInPrompt =
    typeof override?.includeMaxSizeInPrompt === 'boolean'
      ? override.includeMaxSizeInPrompt
      : undefined

  const targetedRangeNudge =
    typeof override?.targetedRangeNudge === 'boolean'
      ? override.targetedRangeNudge
      : undefined

  return {
    maxSizeBytes,
    maxTokens,
    includeMaxSizeInPrompt,
    targetedRangeNudge,
  }
})
// 逐字段校验是**防御性写法**，注释最后一句点明了目标：`no route to cap=0` —— 每个字段单独判「是不是有限正数」，任何一项非法就落回硬编码默认值，绝不允许出现「上限 0」导致所有读取都失败。`includeMaxSizeInPrompt` / `targetedRangeNudge` 是布尔的实验开关，非法时返回 `undefined` 而不是 `false`，让调用方能区分「实验明确关了」和「实验没下发」。
