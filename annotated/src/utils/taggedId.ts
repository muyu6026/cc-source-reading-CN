/**
 * Tagged ID encoding compatible with the API's tagged_id.py format.
 *
 * Produces IDs like "user_01PaGUP2rbg1XDh7Z9W1CEpd" from a UUID string.
 * The format is: {tag}_{version}{base58(uuid_as_128bit_int)}
 *
 * This must stay in sync with api/api/common/utils/tagged_id.py.
 */
// 文件级摘要：把 UUID 编成后端 `tagged_id.py` 同款格式，形如 `user_01PaGUP2rbg1XDh7Z9W1CEpd`。
// 格式是 `{tag}_{version}{base58(128 位整数)}`，两端必须严格一致，改这里等于改协议。

const BASE_58_CHARS =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const VERSION = '01'
// ceil(128 / log2(58)) = 22
const ENCODED_LENGTH = 22
// base58 字母表刻意去掉了容易看错的 0、O、I、l，共 58 个字符。
// 版本号固定 `01`；编码后长度固定 22，因为 58 的 22 次方刚好覆盖 2 的 128 次方。

/**
 * Encode a 128-bit unsigned integer as a fixed-length base58 string.
 */
function base58Encode(n: bigint): string {
  const base = BigInt(BASE_58_CHARS.length)
  const result = new Array<string>(ENCODED_LENGTH).fill(BASE_58_CHARS[0]!)
  let i = ENCODED_LENGTH - 1
  let value = n
  while (value > 0n) {
    const rem = Number(value % base)
    result[i] = BASE_58_CHARS[rem]!
    value = value / base
    i--
  }
  return result.join('')
}
// 定长左填充：先整串填字母表首字符，再从右往左逐位填真实值。
// 这样短数字也会补满 22 位，保证同一 tag 下 ID 长度恒定、可直接按字符串比较。

/**
 * Parse a UUID string (with or without hyphens) into a 128-bit bigint.
 */
function uuidToBigInt(uuid: string): bigint {
  const hex = uuid.replace(/-/g, '')
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID hex length: ${hex.length}`)
  }
  return BigInt('0x' + hex)
}
// 解析前先去掉连字符，再强校验长度为 32——长度不对说明传进来的根本不是 UUID，直接抛错比编出一个错 ID 好。

/**
 * Convert an account UUID to a tagged ID in the API's format.
 *
 * @param tag - The tag prefix (e.g. "user", "org")
 * @param uuid - A UUID string (with or without hyphens)
 * @returns Tagged ID string like "user_01PaGUP2rbg1XDh7Z9W1CEpd"
 */
export function toTaggedId(tag: string, uuid: string): string {
  const n = uuidToBigInt(uuid)
  return `${tag}_${VERSION}${base58Encode(n)}`
}
// 对外唯一入口：解析 UUID 成 bigint，再拼上 tag 与版本号。tag 由调用方给（user、org 等），本模块不校验其合法性。
