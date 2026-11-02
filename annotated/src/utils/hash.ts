/**
 * djb2 string hash — fast non-cryptographic hash returning a signed 32-bit int.
 * Deterministic across runtimes (unlike Bun.hash which uses wyhash). Use as a
 * fallback when Bun.hash isn't available, or when you need on-disk-stable
 * output (e.g. cache directory names that must survive runtime upgrades).
 */
// 文件级：三组哈希工具——djb2（确定性有符号 32 位）、hashContent（Bun 走 Bun.hash，否则 sha256）、hashPair（免拼接的双串哈希）。
// djb2Hash：经典 djb2 字符串哈希，跨运行时确定（不像 Bun.hash 用 wyhash），适合缓存目录名等需落盘稳定的场景。
export function djb2Hash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash
}
// djb2Hash 收尾：循环累乘移位得到有符号 32 位整数。

/**
 * Hash arbitrary content for change detection. Bun.hash is ~100x faster than
 * sha256 and collision-resistant enough for diff detection (not crypto-safe).
 */
// hashContent：变更检测用；Bun 下 Bun.hash 比 sha256 快约 100 倍且够用（非加密安全），Node 下回退 sha256。
export function hashContent(content: string): string {
  if (typeof Bun !== 'undefined') {
    return Bun.hash(content).toString()
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Hash two strings without allocating a concatenated temp string. Bun path
 * seed-chains wyhash (hash(a) feeds as seed to hash(b)); Node path uses
 * incremental SHA-256 update. Seed-chaining naturally disambiguates
 * ("ts","code") vs ("tsc","ode") so no separator is needed under Bun.
 */
// hashPair：不分配拼接临时串；Bun 端把 hash(a) 当 seed 喂给 hash(b)，Node 端用增量 sha256 并以空字节分隔，种子链式天然区分「ts,code」与「tsc,ode」，所以 Bun 下无需分隔符。
export function hashPair(a: string, b: string): string {
  if (typeof Bun !== 'undefined') {
    return Bun.hash(b, Bun.hash(a)).toString()
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto')
  return crypto
    .createHash('sha256')
    .update(a)
    .update('\0')
    .update(b)
    .digest('hex')
}
// hashPair 收尾：Bun 走 wyhash 种子链，Node 走增量 sha256，二者都避开拼接临时串。
