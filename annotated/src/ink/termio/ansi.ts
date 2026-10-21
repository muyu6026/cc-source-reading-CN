// ═══════════════════════════════════════════════════════════════
//  termio 第一层：字节表
// ═══════════════════════════════════════════════════════════════
//
//   `src/ink/termio/` 是一个完整的转义序列解析器（2,271 行），
//   风格明显借鉴了 ghostty 的 action-based 设计 —— types.ts 顶上那句
//   「Inspired by ghostty's action-based design」不是客套话。
//
//   它的分工是：
//     ansi.ts     字节常量（这一层，纯数据）
//     csi.ts      控制序列的参数区间 + 生成函数
//     dec.ts      DEC 私有模式（?25h 这一族）
//     sgr.ts      样式参数（38;5;196 这一族）
//     esc.ts      两字符转义（ESC 7 / ESC c）
//     tokenize.ts 词法：只切边界，不懂语义
//     parser.ts   语法：把序列变成 Action
//     osc.ts      OSC 家族（标题、超链接、剪贴板）
//
// 【这份文件本身没有逻辑，但它定义了整层的「字母表」】
//   后面七个文件里所有的数字比较，都是拿这里的常量做的。
/**
 * ANSI Control Characters and Escape Sequence Introducers
 *
 * Based on ECMA-48 / ANSI X3.64 standards.
 */

/**
 * C0 (7-bit) control characters
 */
// 【为什么只有五个被用到，却把 32 个全写出来】
//
//   实际被引用的只有 BEL/BS/HT/LF/CR/ESC 六个（可以搜一遍）。
//   把 CAN/EM/SUB/DC1 这些冷门控制字符也列全，是因为：
//     · 这张表的价值在于「对着 ECMA-48 查」，缺项反而要去翻文档
//     · 常量对象在运行时只是一块数据，多 26 个数字不值得省
//
//   这个取舍在 types.ts（全量字段的 TextStyle）和 sgr.ts（只列支持的
//   SGR 码）里都能看到同一套判断：**表类代码要么全，要么就只留用到的，
//   中间态最难维护。**
export const C0 = {
  NUL: 0x00,
  SOH: 0x01,
  STX: 0x02,
  ETX: 0x03,
  EOT: 0x04,
  ENQ: 0x05,
  ACK: 0x06,
  BEL: 0x07,
  BS: 0x08,
  HT: 0x09,
  LF: 0x0a,
  VT: 0x0b,
  FF: 0x0c,
  CR: 0x0d,
  SO: 0x0e,
  SI: 0x0f,
  DLE: 0x10,
  DC1: 0x11,
  DC2: 0x12,
  DC3: 0x13,
  DC4: 0x14,
  NAK: 0x15,
  SYN: 0x16,
  ETB: 0x17,
  CAN: 0x18,
  EM: 0x19,
  SUB: 0x1a,
  ESC: 0x1b,
  FS: 0x1c,
  GS: 0x1d,
  RS: 0x1e,
  US: 0x1f,
  DEL: 0x7f,
} as const

// String constants for output generation
// 【数字常量与字符串常量并存，用途不同】
//
//   C0 里的是 **number**，用于 `charCodeAt(i) === C0.ESC` 这种比较；
//   这里的是 **string**，用于拼输出 `ESC + '['`、`parts.join(SEP)`。
//
//   两者混用会出很隐蔽的错：`charCodeAt(i) === ESC` 恒为 false（字符串
//   与数字比较），TypeScript 会拦住；但 `'\x1b' === 27` 这种在 JS 里
//   静默为 false，而 ESLint 不一定报。所以宁可两份常量。
export const ESC = '\x1b'
export const BEL = '\x07'
export const SEP = ';'

/**
 * Escape sequence type introducers (byte after ESC)
 */
// 【七个引导字节，但只有四个被词法器当成「定长字符串」处理】
//
//   CSI 0x5b [     参数序列（最常用）
//   OSC 0x5d ]     操作系统命令（有负载，BEL 或 ESC 反斜杠结尾）
//   DCS 0x50 P     设备控制串（同上）
//   APC 0x5f _     应用私有（同上）
//   PM  0x5e ^     隐私消息  ← 声明了，tokenize.ts 没有对应状态
//   SOS 0x58 X     字符串开始 ← 同上
//   ST  0x5c 反斜杠  字符串终结符（不是引导符，是结束符）
//
//   于是 PM 和 SOS 会走到 tokenize.ts 的 escape 分支里 `isEscFinal`
//   那一支 —— 因为 0x5e 和 0x58 都落在 0x30-0x7e 区间内。结果是
//   「ESC ^」被当成一条两字符序列整体发射，**后面那一大段 PM 负载
//   会当作文本漏出来**。
//
//   这不算 bug，因为没有任何终端会往 stdout 写 PM/SOS。但它说明
//   「常量表里有的」≠「实现里支持的」，读代码时要分开数。
export const ESC_TYPE = {
  CSI: 0x5b, // [ - Control Sequence Introducer
  OSC: 0x5d, // ] - Operating System Command
  DCS: 0x50, // P - Device Control String
  APC: 0x5f, // _ - Application Program Command
  PM: 0x5e, // ^ - Privacy Message
  SOS: 0x58, // X - Start of String
  ST: 0x5c, // \ - String Terminator
} as const

/** Check if a byte is a C0 control character */
// 【DEL（0x7f）不是 C0，但被判成 C0】
//
//   C0 的正式范围是 0x00-0x1F。0x7F 属于另一类「格式控制符」。
//   这里合并判断，语义其实是「不可打印的单字节」—— 名字叫 isC0
//   属于历史遗留的宽松叫法。
//
//   调用点主要在 parse-keypress / key 解析里，用途是「这个字符该不该
//   出现在输入框」。所以「不可打印」这个语义比「属于 C0」更贴切。
export function isC0(byte: number): boolean {
  return byte < 0x20 || byte === 0x7f
}

/**
 * Check if a byte is an ESC sequence final byte (0-9, :, ;, <, =, >, ?, @ through ~)
 * ESC sequences have a wider final byte range than CSI
 */
// 【ESC 的合法尾字节范围比 CSI 宽，这一点必须分开写】
//
//   ESC  尾字节：0x30-0x7e（数字 0-9、冒号、分号、<=>?、@ 到 ~）
//   CSI  尾字节：0x40-0x7e（只有 @ 到 ~）
//
//   为什么要宽：`ESC 7`（DECSC 保存光标）的尾字节是 0x37，`ESC 8` 是
//   0x38，`ESC =` 是 0x3d —— 全都在 0x40 以下。如果这里的判断复用
//   csi.ts 的 isCSIFinal，ESC 7 / ESC 8 会被判成「非法序列」，
//   然后被降级成文本输出。
//
//   所以这两个函数看起来几乎一样，**不能合并**。
export function isEscFinal(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x7e
}
