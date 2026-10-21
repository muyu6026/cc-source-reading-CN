// ═══════════════════════════════════════════════════════════════
//  SGR：把 `ESC [ 1 ; 38 ; 5 ; 196 m` 变成 TextStyle
// ═══════════════════════════════════════════════════════════════
//
//   SGR = Select Graphic Rendition，是 CSI 家族里最复杂的一支，
//   因为它是唯一**带子语法**的：分号是平铺分隔，冒号是子参数。
//
//     38;5;196     平铺：38（扩展前景色），5（256 色模式），196（色号）
//     38:5:196     冒号：38，子参数 [5, 196]
//     38;2;255;0;0 平铺真彩色
//     38:2::255:0:0 冒号 + 空色彩空间字段
//
//   两种写法**语义相同但结构不同**，所以这份文件有两个解析器：
//   parseParams 管结构，parseExtendedColor 管「值藏在哪个位置」。
//
//   【为什么 SGR 不能复用 parser.ts 的 parseCSIParams】
//   那个函数是 `split(/[;:]/)` —— 把冒号和分号一视同仁地切开。
//   对 38:5:196 会得到 [38,5,196]，看起来没错；但对 38:2::255:0:0
//   会得到 [38,2,0,255,0,0]（空串变 0），**色彩空间的「空」和「0」
//   被抹平了**。所以 parser.ts 让 SGR 走单独的入口，
//   直接把原始字符串交给这里（parser.ts 115 行）。
/**
 * SGR (Select Graphic Rendition) Parser
 *
 * Parses SGR parameters and applies them to a TextStyle.
 * Handles both semicolon (;) and colon (:) separated parameters.
 */

import type { NamedColor, TextStyle, UnderlineStyle } from './types.js'
import { defaultStyle } from './types.js'

// 与 types.ts 的 NamedColor 逐项对应，且**必须保持同一顺序** ——
//   这里靠下标取色，顺序错了就静默变色。见 types.ts 13 行那段批注。
const NAMED_COLORS: NamedColor[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
]

// 下标就是 `4:N` 里的 N。所以 `4:0` 得到 'none'（关掉下划线），
//   `4:3` 得到 'curly'。越界的 N 由 158 行的 `?? 'single'` 兜底。
const UNDERLINE_STYLES: UnderlineStyle[] = [
  'none',
  'single',
  'double',
  'curly',
  'dotted',
  'dashed',
]

// 【一个参数要么是数字，要么是数字加子参数列表】
//
//   value     主值（分号分隔时用）
//   subparams 子参数（冒号分隔之后的所有数字）
//   colon     这个参数用的是冒号语法吗 —— **下游靠它决定语义**
//
//   为什么要记 colon：`38;5;196` 和 `38:5:196` 在 parseParams 之后
//   结构完全不同（前者是三个 Param，后者是一个 Param 带两个 subparams），
//   所以「怎么读」必须知道「当初怎么写」。colon 字段就是这个记忆。
//
//   这也解释了 273 行那行自增逻辑为什么要分三种情况 ——
//   消费的参数个数取决于语法形式。
type Param = { value: number | null; subparams: number[]; colon: boolean }

function parseParams(str: string): Param[] {
// 【空参数串 = 重置，不是「什么都不做」】
//
//   `ESC [ m` 是终端里最常见的重置写法（和 `ESC [ 0 m` 等价）。
//   如果不特判，parseParams('') 会返回空数组，applySGR 的 while 循环
//   一次都不进，样式原样返回 —— **重置变成空操作**。
//
//   这是「空集合」和「含一个零值元素」的区别。同类问题在 URI 解析、
//   HTTP 头解析里到处都是：**空字符串往往有特定语义，不能当成「零项」。**
  if (str === '') return [{ value: 0, subparams: [], colon: false }]

  const result: Param[] = []
  let current: Param = { value: null, subparams: [], colon: false }
  let num = ''
  let inSub = false

// 【循环条件是 `<=` 而不是 `<`，末尾那个 undefined 是故意的】
//
//   `i < str.length` 时最后一个数字永远处理不到（它后面没有分隔符）。
//   常规写法是在循环后补一段「处理剩余数字」的重复代码。
//
//   这里是让 i 多走一格：`str[str.length]` 是 undefined，而 51 行的
//   条件是 `c === ';' || c === undefined` —— 于是**结束条件与分隔条件
//   合一**，循环体只写一份。
//
//   代价：这个技巧依赖「字符串越界访问返回 undefined」。
//   TypeScript 的 noUncheckedIndexedAccess 打开时，`const c = str[i]`
//   的类型是 `string | undefined`，正好合用。
  for (let i = 0; i <= str.length; i++) {
    const c = str[i]
    if (c === ';' || c === undefined) {
      const n = num === '' ? null : parseInt(num, 10)
      if (inSub) {
        if (n !== null) current.subparams.push(n)
      } else {
        current.value = n
      }
      result.push(current)
      current = { value: null, subparams: [], colon: false }
      num = ''
      inSub = false
// 冒号分支：第一次遇到冒号时把已积累的数字存进 value 并置 colon，
//   之后的数字全部进 subparams。
//
//   注意 `inSub` 一旦置真就不再复位（除了遇到分号）。所以
//   `38:5:196;1` 里 `1` 属于新参数（分号复位了 inSub），
//   而 `38:5:196:7` 里 7 会被塞进 38 的子参数 —— 后者是畸形输入，
//   但至少不会崩。
    } else if (c === ':') {
      const n = num === '' ? null : parseInt(num, 10)
      if (!inSub) {
        current.value = n
        current.colon = true
        inSub = true
      } else {
        if (n !== null) current.subparams.push(n)
      }
      num = ''
    } else if (c >= '0' && c <= '9') {
      num += c
    }
  }
  return result
}

// 【扩展颜色最难的地方不是解析，是「值藏在第几个位置」】
//
//   冒号形式：38:5:N 或 38:2:R:G:B 或 38:2:cs:R:G:B
//   分号形式：38;5;N 或 38;2;R;G;B
//
//   两种形式的起点不同：冒号形式的子参数从 params[idx] 里拿，
//   分号形式要往 params[idx+1] 之后找。所以这个函数有两条完全独立的路径。
//
//   返回类型 `{r,g,b} | {index} | null` 靠 `'index' in c` 区分
//   （273 行），而不是加一个 type 字段 —— 用结构区分而不是标签区分，
//   少一个字段，代价是可读性。
function parseExtendedColor(
  params: Param[],
  idx: number,
): { r: number; g: number; b: number } | { index: number } | null {
  const p = params[idx]
  if (!p) return null

  if (p.colon && p.subparams.length >= 1) {
    if (p.subparams[0] === 5 && p.subparams.length >= 2) {
      return { index: p.subparams[1]! }
    }
// 【`off` 这个偏移量，是整份文件最需要解释的一行】
//
//   `38:2:R:G:B`    4 个子参数：[2, R, G, B]
//   `38:2:cs:R:G:B` 5 个子参数：[2, cs, R, G, B]  cs = 色彩空间（0 = sRGB）
//
//   所以子参数个数 ≥ 5 时，第 2 个是色彩空间，真正的 RGB 要往后挪一位。
//   判断条件是 `length >= 5`，然后 off = 1。
//
//   为什么不能只判 `length === 5`：某些终端会发 `38:2:0:R:G:B:extra`
//   这种超长形式（多一个颜色容差参数），也得按「有色彩空间」处理。
//   所以用的是 ≥。
//
//   写错这里的后果不是报错，是**红色变成绿色**（通道整体错位一格）——
//   又一个「静默错位」型 bug。
    if (p.subparams[0] === 2 && p.subparams.length >= 4) {
      const off = p.subparams.length >= 5 ? 1 : 0
      return {
        r: p.subparams[1 + off]!,
        g: p.subparams[2 + off]!,
        b: p.subparams[3 + off]!,
      }
    }
  }

// 分号形式从这里开始，走完全不同的路径：参数是平铺的，值在后面的位置。
//
//   注意 100 行的 `if (!next) return null`：`38` 后面什么都没有时返回 null，
//   调用方会走到 305 行的 `i++` —— 只跳过 38 这一个参数。
//   如果后面还跟着一个 `5`（比如畸形的 `ESC [ 38 ; 5 m`），
//   那个 5 会被当成 **blink（闪烁）** 单独解析。
//
//   这是畸形输入的常见结局：**不崩，但产生一个看起来无关的效果**。
//   排查这类问题得从「意外的副作用」倒推回「哪个参数没被消费」。
  const next = params[idx + 1]
  if (!next) return null
  if (
    next.value === 5 &&
    params[idx + 2]?.value !== null &&
    params[idx + 2]?.value !== undefined
  ) {
    return { index: params[idx + 2]!.value! }
  }
// 真彩色分支的三个值都要「既不是 null 也不是 undefined」。
//
//   null  表示参数存在但是空（`38;2;;0;0` 里那个空）
//   undefined 表示参数根本不够（`38;2;255` 只有三个）
//
//   两者都要拒绝，因为 0 是合法值（纯黑）。这就是为什么不能写
//   `if (r && g && b)` —— 那会让 `38;2;0;0;0`（黑）解析失败，
//   然后落到 305 行被整个丢掉。**用真值判断处理可能为 0 的数字，
//   是一个反复出现的坑。**
  if (next.value === 2) {
    const r = params[idx + 2]?.value
    const g = params[idx + 3]?.value
    const b = params[idx + 4]?.value
    if (
      r !== null &&
      r !== undefined &&
      g !== null &&
      g !== undefined &&
      b !== null &&
      b !== undefined
    ) {
      return { r, g, b }
    }
  }
  return null
}

// 主循环。外层结构是「一串 if 而不是 switch」。
//
//   为什么：SGR 的码位是**稀疏**的（0-9、21-29、30-37、40-47、53-58、
//   90-107），用 switch 会被编译成跳转表带大量空洞。if 链在 V8 上是
//   一串可预测的值比较，热路径上更稳。
//
//   同样的形态在 parser.ts 的 parseCSI 里又出现一次（二十来个 if）。
//   这两处都是「码位稀疏 + 分支极短」的场景，属于同一类判断。
export function applySGR(paramStr: string, style: TextStyle): TextStyle {
  const params = parseParams(paramStr)
// 【浅拷贝一次，之后全程原地改】
//
//   这么写的前提是 TextStyle 全是标量字段（除了三个 Color 对象，
//   而它们每次都是整体替换，不做原地修改）。
//
//   如果哪天有人加了嵌套对象字段并原地改它，就会污染调用方传进来的
//   style —— 那种 bug 极难查，因为症状取决于「谁先读」。
//   **拷贝的深浅必须与「后续怎么改」匹配。**
  let s = { ...style }
  let i = 0

  while (i < params.length) {
    const p = params[i]!
// `p.value ?? 0` —— 空参数按 0 处理。
//
//   所以 `ESC [ ; 31 m` 的第一个空参数是 0，即**重置**，然后才是红色。
//   标准（ECMA-48）确实规定空参数等于 0。这和「缺省值」不是一回事：
//   `ESC [ 31 m` 只有一个参数，不存在「空参数」。
//
//   区分「参数缺失」和「参数为空」在这里靠的是 params 数组长度，
//   而不是值的 null 性 —— 所以 110 行那三个 null 检查是有意义的。
    const code = p.value ?? 0

// 【0 是重置，而且它是**唯一**会替换整个对象的分支】
//
//   `s = defaultStyle()` 而不是「逐字段清零」。区别在于：如果将来
//   TextStyle 加了新字段，逐字段清零一定会漏（漏了就是「重置之后
//   某个属性还留着」），而重建对象不会漏。
//
//   「重置」这类操作永远应该写成「造一个新的默认值」，
//   而不是「把每个字段恢复」—— 后者每加一个字段就多一个漏点。
    if (code === 0) {
      s = defaultStyle()
      i++
      continue
    }
    if (code === 1) {
      s.bold = true
      i++
      continue
    }
    if (code === 2) {
      s.dim = true
      i++
      continue
    }
    if (code === 3) {
      s.italic = true
      i++
      continue
    }
// 【4 的两副面孔：裸 4 和 4:N】
//
//   `4`      → single（下划线）
//   `4:0`    → none（关掉）
//   `4:3`    → curly（波浪，kitty/wezterm 支持）
//   `4:9`    → 越界，`?? 'single'` 兜底成普通下划线
//
//   越界兜底选 'single' 而不是 'none'，是「宁可多画一条线也不要静默消失」
//   的判断。反过来选的话，一个不认识的子参数会让下划线凭空消失。
    if (code === 4) {
      s.underline = p.colon
        ? (UNDERLINE_STYLES[p.subparams[0]!] ?? 'single')
        : 'single'
      i++
      continue
    }
    if (code === 5 || code === 6) {
      s.blink = true
      i++
      continue
    }
    if (code === 7) {
      s.inverse = true
      i++
      continue
    }
    if (code === 8) {
      s.hidden = true
      i++
      continue
    }
    if (code === 9) {
      s.strikethrough = true
      i++
      continue
    }
// 【21 号码有历史分歧，这里选了标准那一侧】
//
//   ECMA-48：21 = 双下划线（doubly underlined）
//   早期终端（以及一部分现代终端）：21 = 取消加粗（bold off）
//
//   这里取「双下划线」，配套的是 22 号码（见下一段）同时取消 bold 和 dim。
//   如果某个终端把 21 当 bold off，会出现「想取消加粗却画出了双下划线」——
//   但因为这个程序不输出 21，只在解析外部文本时会碰到。
//
//   21 和 22 的分工在标准里是清楚的：**21 管下划线，22 管强度**。
//   历史上把 21 当 bold off 的那批终端，才是偏离标准的一方。
    if (code === 21) {
      s.underline = 'double'
      i++
      continue
    }
// 【22 同时关掉 bold 和 dim —— 这不是偷懒，是标准如此】
//
//   ECMA-48 把 bold（1）和 faint（2）归为同一个属性「强度」，
//   而 22 是「normal intensity」—— 所以它必须同时清掉两者。
//
//   直觉上会以为「22 是 1 的反操作，所以只该关 bold」，于是写出
//   `s.bold = false` 就收工。后果是：一段用了 dim 的文字，在遇到
//   取消加粗之后仍然保持暗淡，而终端已经恢复正常亮度 ——
//   **屏幕上的暗淡和终端状态不一致了**。
//
//   同一组的还有 23/24/25/27/28/29，都是一对一。只有 22 是一对二。
    if (code === 22) {
      s.bold = false
      s.dim = false
      i++
      continue
    }
    if (code === 23) {
      s.italic = false
      i++
      continue
    }
    if (code === 24) {
      s.underline = 'none'
      i++
      continue
    }
    if (code === 25) {
      s.blink = false
      i++
      continue
    }
    if (code === 27) {
      s.inverse = false
      i++
      continue
    }
    if (code === 28) {
      s.hidden = false
      i++
      continue
    }
    if (code === 29) {
      s.strikethrough = false
      i++
      continue
    }
// 53 = overline（上划线），55 = 取消上划线。
//
//   这两个码位在标准里属于「很少用」的一类，支持度也参差。
//   放在这里是因为 TextStyle 有 overline 字段 —— 类型里的每个字段
//   都得有一个 SGR 码能设置它，否则那个字段永远只能是 false。
//
//   反过来说：**TextStyle 里没有的字段，这里就不用管**。所以
//   10-19（字体选择）、20（fraktur）、26（等宽）、73-75（上下标）
//   全都没处理 —— 未来看这段代码时不要以为是漏了。
    if (code === 53) {
      s.overline = true
      i++
      continue
    }
    if (code === 55) {
      s.overline = false
      i++
      continue
    }

// 【三个区间共用同一个表，靠偏移量区分】
//
//   30-37   → NAMED_COLORS[code - 30]      标准 8 色前景
//   40-47   → NAMED_COLORS[code - 40]      标准 8 色背景
//   90-97   → NAMED_COLORS[code - 90 + 8]  亮色前景
//   100-107 → NAMED_COLORS[code - 100 + 8] 亮色背景
//
//   那四个 `+ 8` 是「亮色从下标 8 开始」这个约定的体现。
//   四个区间、两个偏移基准、两个属性（fg/bg），一共四种组合，
//   全部写成显式分支而不是查表 —— 因为查表要构造一张 128 项的映射，
//   而这里只有四个区间。
//
//   39 / 49 是「恢复默认」，不能落进任何区间（它们不在 30-37 里），
//   所以必须单独判，见 240 / 250 行。
    if (code >= 30 && code <= 37) {
      s.fg = { type: 'named', name: NAMED_COLORS[code - 30]! }
      i++
      continue
    }
    if (code === 39) {
      s.fg = { type: 'default' }
      i++
      continue
    }
    if (code >= 40 && code <= 47) {
      s.bg = { type: 'named', name: NAMED_COLORS[code - 40]! }
      i++
      continue
    }
    if (code === 49) {
      s.bg = { type: 'default' }
      i++
      continue
    }
    if (code >= 90 && code <= 97) {
      s.fg = { type: 'named', name: NAMED_COLORS[code - 90 + 8]! }
      i++
      continue
    }
    if (code >= 100 && code <= 107) {
      s.bg = { type: 'named', name: NAMED_COLORS[code - 100 + 8]! }
      i++
      continue
    }

// 【38/48/58 三个扩展颜色共用一套解析，但步进量各不相同】
//
//   38 前景 / 48 背景 / 58 下划线颜色。58 是最晚加的（kitty 提出），
//   支持度最差。
//
//   注意三个分支的代码**完全一样，只有目标字段不同**。没有抽成
//   公共函数是因为「目标字段」是编译期的 lvalue，抽出来要么传
//   setter 闭包（多一次分配），要么传字段名（多一次字符串比较）。
//   三次重复在这里比抽象便宜。
    if (code === 38) {
      const c = parseExtendedColor(params, i)
      if (c) {
        s.fg =
          'index' in c
            ? { type: 'indexed', index: c.index }
            : { type: 'rgb', ...c }
// 【这一行决定「接下来跳过几个参数」，写错就是整条序列错位】
//
//   冒号形式：值全在 params[i] 的子参数里，**只占一个 Param** → +1
//   分号 256 色：38 ; 5 ; N 占三个 Param → +3
//   分号真彩色：38 ; 2 ; R ; G ; B 占五个 Param → +5
//
//   三种情况的判断顺序不能换：先看 colon（语法形式优先），
//   再用 `'index' in c` 区分 256 色和真彩色（结果形状）。
//
//   如果这里少跳了（比如真彩色按 +3 处理），后面的 G 和 B 会被当成
//   独立的 SGR 码解析 —— 255 和 0 都不是合法码，于是被 305 行的
//   兜底 `i++` 一个个跳过，看起来「居然还能用」。但如果恰好是
//   `38;2;1;2;3`，那两个 2 和 3 会变成 dim 和 italic。
//   **又一次静默错位。**
        i += p.colon ? 1 : 'index' in c ? 3 : 5
        continue
      }
    }
    if (code === 48) {
      const c = parseExtendedColor(params, i)
      if (c) {
        s.bg =
          'index' in c
            ? { type: 'indexed', index: c.index }
            : { type: 'rgb', ...c }
        i += p.colon ? 1 : 'index' in c ? 3 : 5
        continue
      }
    }
// 58 = 下划线颜色。和 38/48 完全同构，59 是它的「恢复默认」。
//
//   这个属性的终端支持度是三个里最差的：很多终端宁可忽略 58
//   也不报错，所以「设了没效果」是常态而不是 bug。
    if (code === 58) {
      const c = parseExtendedColor(params, i)
      if (c) {
        s.underlineColor =
          'index' in c
            ? { type: 'indexed', index: c.index }
            : { type: 'rgb', ...c }
        i += p.colon ? 1 : 'index' in c ? 3 : 5
        continue
      }
    }
    if (code === 59) {
      s.underlineColor = { type: 'default' }
      i++
      continue
    }

// 【兜底 `i++`：认不出的码位就跳过，不报错、不影响后续】
//
//   这个策略让 SGR 解析变得极其鲁棒 —— 任何未来新增的码位都会被
//   安全忽略，样式保持原样。这也是为什么 21/53/58 这些冷门码
//   可以直接加进来而不影响旧行为。
//
//   代价是：**拼错的码位也不会被发现**。比如误写 `ESC [ 31 ; 999 m`，
//   31 生效、999 被跳过，看不出任何异常。
//
//   同时这里也是「扩展色解析失败」的落点：如果 38 后面跟的东西
//   不构成合法颜色，parseExtendedColor 返回 null，两个 if 都不进，
//   最后走到这里 —— 只跳过 38 本身，后面的参数会各自当独立码处理。
    i++
  }
  return s
}
