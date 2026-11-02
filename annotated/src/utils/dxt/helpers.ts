import type { McpbManifest } from '@anthropic-ai/mcpb'
// DXT 扩展清单的校验与 ID 生成：读 .dxt 与 .mcpb 包时先把 manifest 校验成强类型，再据此算出稳定的扩展标识。
import { errorMessage } from '../errors.js'
import { jsonParse } from '../slowOperations.js'

/**
 * Parses and validates a DXT manifest from a JSON object.
 *
 * Lazy-imports @anthropic-ai/mcpb: that package uses zod v3 which eagerly
 * creates 24 .bind(this) closures per schema instance (~300 instances between
 * schemas.js and schemas-loose.js). Deferring the import keeps ~700KB of bound
 * closures out of the startup heap for sessions that never touch .dxt/.mcpb.
 */
export async function validateManifest(
  manifestJson: unknown,
): Promise<McpbManifest> {
  const { McpbManifestSchema } = await import('@anthropic-ai/mcpb')
// 这里才 import 校验库：那个包依赖 zod v3，每个 schema 实例会预建 24 个 bind 闭包，约 700KB，推迟到真正用到 .dxt 时才付这笔内存。
  const parseResult = McpbManifestSchema.safeParse(manifestJson)

  if (!parseResult.success) {
    const errors = parseResult.error.flatten()
    const errorMessages = [
      ...Object.entries(errors.fieldErrors).map(
        ([field, errs]) => `${field}: ${errs?.join(', ')}`,
      ),
      ...(errors.formErrors || []),
    ]
      .filter(Boolean)
      .join('; ')

    throw new Error(`Invalid manifest: ${errorMessages}`)
  }

  return parseResult.data
}
// 校验失败时把 zod 的 fieldErrors 与 formErrors 拼成一条人话：字段级错误带字段名，表单级错误直接拼，最后用分号连接。

/**
 * Parses and validates a DXT manifest from raw text data.
 */
export async function parseAndValidateManifestFromText(
  manifestText: string,
): Promise<McpbManifest> {
  let manifestJson: unknown

  try {
    manifestJson = jsonParse(manifestText)
  } catch (error) {
    throw new Error(`Invalid JSON in manifest.json: ${errorMessage(error)}`)
  }

  return validateManifest(manifestJson)
}
// 文本入口只多做一件事：JSON 解析失败的报错要和「结构不合法」区分开，否则用户分不清是语法写错还是字段写错。

/**
 * Parses and validates a DXT manifest from raw binary data.
 */
export async function parseAndValidateManifestFromBytes(
  manifestData: Uint8Array,
): Promise<McpbManifest> {
  const manifestText = new TextDecoder().decode(manifestData)
  return parseAndValidateManifestFromText(manifestText)
}
// 字节入口只做解码后转发：二进制到文本的转换放在最外层，校验逻辑一份，三个入口共用。

/**
 * Generates an extension ID from author name and extension name.
 * Uses the same algorithm as the directory backend for consistency.
 */
export function generateExtensionId(
  manifest: McpbManifest,
  prefix?: 'local.unpacked' | 'local.dxt',
): string {
  const sanitize = (str: string) =>
    str
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_.]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
// 清洗步骤固定五拍：转小写、空白转连字符、剔除非 字母数字 与 连字符 下划线 点、合并连续连字符、去掉首尾连字符。与目录后端同一套算法，保证同名扩展算出同一个 ID。

  const authorName = manifest.author.name
  const extensionName = manifest.name

  const sanitizedAuthor = sanitize(authorName)
  const sanitizedName = sanitize(extensionName)

  return prefix
    ? `${prefix}.${sanitizedAuthor}.${sanitizedName}`
    : `${sanitizedAuthor}.${sanitizedName}`
}
// 前缀参数区分本地未解包与本地 dxt 两种来源，最终形如 前缀.作者.扩展名；不传前缀时只有两段。
