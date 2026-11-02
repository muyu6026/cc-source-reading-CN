/**
 * Unicode Sanitization for Hidden Character Attack Mitigation
 *
 * This module implements security measures against Unicode-based hidden character attacks,
 * specifically targeting ASCII Smuggling and Hidden Prompt Injection vulnerabilities.
 * These attacks use invisible Unicode characters (such as Tag characters, format controls,
 * private use areas, and noncharacters) to hide malicious instructions that are invisible
 * to users but processed by AI models.
 *
 * The vulnerability was demonstrated in HackerOne report #3086545 targeting Claude Desktop's
 * MCP (Model Context Protocol) implementation, where attackers could inject hidden instructions
 * using Unicode Tag characters that would be executed by Claude but remain invisible to users.
 *
 * Reference: https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/
 *
 * This implementation provides comprehensive protection by:
 * 1. Applying NFKC Unicode normalization to handle composed character sequences
 * 2. Removing dangerous Unicode categories while preserving legitimate text and formatting
 * 3. Supporting recursive sanitization of complex nested data structures
 * 4. Maintaining performance with efficient regex processing
 *
 * The sanitization is always enabled to protect against these attacks.
 */
// Unicode 隐形字符攻击的防线：针对 ASCII 走私与隐藏提示注入——Tag 字符、格式控制符、私用区、非字符可以肉眼看不见却会被模型读到。起因是 HackerOne #3086545 对 Claude Desktop MCP 的实测。

export function partiallySanitizeUnicode(prompt: string): string {
  let current = prompt
  let previous = ''
  let iterations = 0
  const MAX_ITERATIONS = 10 // Safety limit to prevent infinite loops
// 迭代上限 10 是保险丝：归一化加删除理论上一两轮就该收敛，超限说明输入被人为构造过，直接抛错而不是继续吞。

  // Iteratively sanitize until no more changes occur or max iterations reached
  while (current !== previous && iterations < MAX_ITERATIONS) {
    previous = current

    // Apply NFKC normalization to handle composed character sequences
    current = current.normalize('NFKC')
// NFKC 归一化先行：把兼容组合序列折成规范形，否则某些危险字符换个写法就能躲过按码点匹配的删除规则。

    // Remove dangerous Unicode categories using explicit character ranges

    // Method 1: Strip dangerous Unicode property classes
    // This is the primary defence and is the solution that is widely used in OSS libraries.
    current = current.replace(/[\p{Cf}\p{Co}\p{Cn}]/gu, '')
// 第一层用 Unicode 属性类一把删：Cf 格式控制、Co 私用区、Cn 未分配，这是 OSS 通用做法，靠引擎的属性正则。

    // Method 2: Explicit character ranges. There are some subtle issues with the above method
    // failing in certain environments that don't support regexes for unicode property classes,
    // so we also implement a fallback that strips out some specifically known dangerous ranges.
    current = current
      .replace(/[\u200B-\u200F]/g, '') // Zero-width spaces, LTR/RTL marks
      .replace(/[\u202A-\u202E]/g, '') // Directional formatting characters
      .replace(/[\u2066-\u2069]/g, '') // Directional isolates
      .replace(/[\uFEFF]/g, '') // Byte order mark
      .replace(/[\uE000-\uF8FF]/g, '') // Basic Multilingual Plane private use
// 第二层是显式码点范围的兜底：某些运行时不支持属性类正则，于是零宽空格、双向控制、双向隔离、BOM、BMP 私用区逐段手写。两层语义重叠是刻意的冗余防御。

    iterations++
  }

  // If we hit max iterations, crash loudly. This should only ever happen if there is a bug or if someone purposefully created a deeply nested unicode string.
  if (iterations >= MAX_ITERATIONS) {
    throw new Error(
      `Unicode sanitization reached maximum iterations (${MAX_ITERATIONS}) for input: ${prompt.slice(0, 100)}`,
    )
  }
// 超限抛错带上输入前 100 字符：排障需要知道是什么触发的，但又不能把可能含注入内容的完整原文塞进异常。

  return current
}
// 收敛判定是「本轮没变」：删除与归一化可能暴露出新的危险序列（删掉一个字符后相邻字符组合出新形态），所以循环到不动点为止。

export function recursivelySanitizeUnicode(value: string): string
export function recursivelySanitizeUnicode<T>(value: T[]): T[]
export function recursivelySanitizeUnicode<T extends object>(value: T): T
export function recursivelySanitizeUnicode<T>(value: T): T
export function recursivelySanitizeUnicode(value: unknown): unknown {
// 递归版有四个重载：字符串原样、数组逐项、对象逐键值、其余类型兜底。重载只服务类型推导，运行时只有一个实现。
  if (typeof value === 'string') {
    return partiallySanitizeUnicode(value)
  }

  if (Array.isArray(value)) {
    return value.map(recursivelySanitizeUnicode)
  }

  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      sanitized[recursivelySanitizeUnicode(key)] =
        recursivelySanitizeUnicode(val)
    }
    return sanitized
  }
// 对象分支连键名一起清洗：键也可能是字符串，漏掉键就等于留了一条注入通道。

  // Return other primitive values (numbers, booleans, null, undefined) unchanged
  return value
}
// 数字、布尔、null、undefined 原样返回：清洗只针对文本载体，其他原始值既不含字符也无须重建。
