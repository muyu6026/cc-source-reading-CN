// 文件级批注：`uuid.ts` 提供 UUID 校验与 AgentId 生成两个小工具，依赖 Node `crypto` 的 `randomBytes`。
import { randomBytes, type UUID } from 'crypto'
import type { AgentId } from 'src/types/ids.js'

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validate uuid
 * @param maybeUUID The value to be checked if it is a uuid
 * @returns string as UUID or null if it is not valid
 */
// 第一个函数签名：校验任意值是否为合法 UUID（8-4-4-4-12 十六进制），非字符串或格式不符返回 `null`。
export function validateUuid(maybeUuid: unknown): UUID | null {
  // UUID format: 8-4-4-4-12 hex digits
  if (typeof maybeUuid !== 'string') return null

  return uuidRegex.test(maybeUuid) ? (maybeUuid as UUID) : null
}
// 第一个函数收尾：用预编译正则做格式测试，命中则断言为 `UUID` 类型返回，否则 `null`。

/**
 * Generate a new agent ID with prefix for consistency with task IDs.
 * Format: a{label-}{16 hex chars}
 * Example: aa3f2c1b4d5e6f7a8, acompact-a3f2c1b4d5e6f7a8
 */
// 第二个函数签名：生成带前缀的 AgentId（形如 `a{后缀}` 或 `a{label}-{后缀}`），后缀为 16 个十六进制字符，与任务 ID 风格保持一致。
export function createAgentId(label?: string): AgentId {
  const suffix = randomBytes(8).toString('hex')
  return (label ? `a${label}-${suffix}` : `a${suffix}`) as AgentId
}
// 第二个函数收尾：取 8 字节随机数转十六进制作后缀，按是否带 label 拼成最终 ID 并断言为 `AgentId`。
