import chalk from 'chalk'
import type { Color, TextStyles } from './styles.js'

// ═══════════════════════════════════════════════════════════════
//  颜色层：真彩色在两个地方会被悄悄降级
// ═══════════════════════════════════════════════════════════════
//
//   这个文件的前 62 行不是函数，是**模块加载时执行的两个副作用**：
//   它们直接改 chalk 的单例状态（chalk.level），而且顺序有讲究。
//
// 【为什么需要降级判断】
//   真彩色（24 位，rgb(r,g,b)）需要终端支持。chalk 用 supports-color
//   探测能力，得到一个 level：
//       0  无颜色    1  16 色    2  256 色    3  真彩色
//   探测不准的两个场景，恰好是这里两段代码：
//     · VS Code 系（xterm.js）—— 能力够，但**自报家门不被认识**
//     · tmux —— 自己能处理，但**转发时按另一个终端的声明做决定**
//   这两类都不是「终端不支持」，是「探测逻辑看不到真相」。
//   所以补丁的位置不在渲染，在探测。
//
// 【共同点：两段都是「向上修正」或「向下妥协」，没有一段是「精确探测」】
//   第一段把 level 2 硬提到 3（假定 VS Code 一定能显示真彩色）。
//   第二段把 level 3 硬压到 2（假定 tmux 一定转发不了）。
//   都是基于「环境变量的粗判 + 已知的失败模式」，不是能力查询。
//   这是终端生态的现状：**没有可靠的运行时能力协商**，
//   只有一堆互相矛盾的约定（TERM、COLORTERM、TERM_PROGRAM、DA、XTGETTCAP…）。
/**
 * xterm.js (VS Code, Cursor, code-server, Coder) has supported truecolor
 * since 2017, but code-server/Coder containers often don't set
 * COLORTERM=truecolor. chalk's supports-color doesn't recognize
 * TERM_PROGRAM=vscode (it only knows iTerm.app/Apple_Terminal), so it falls
 * through to the -256color regex → level 2. At level 2, chalk.rgb()
 * downgrades to the nearest 6×6×6 cube color: rgb(215,119,87) (Claude
 * orange) → idx 174 rgb(215,135,135) — washed-out salmon.
 *
 * Gated on level === 2 (not < 3) to respect NO_COLOR / FORCE_COLOR=0 —
 * those yield level 0 and are an explicit "no colors" request. Desktop VS
 * Code sets COLORTERM=truecolor itself, so this is a no-op there (already 3).
 *
 * Must run BEFORE the tmux clamp — if tmux is running inside a VS Code
 * terminal, tmux's passthrough limitation wins and we want level 2.
 */
// 第一段补丁：VS Code / Cursor / code-server / Coder 这些 xterm.js 系。
//
//   链条是这样的：
//     xterm.js 从 2017 年就支持真彩色
//     → 但 code-server / Coder 的容器里常常不设 COLORTERM=truecolor
//     → chalk 的 supports-color **不认识 TERM_PROGRAM=vscode**
//       （它只认 iTerm.app 和 Apple_Terminal）
//     → 于是落到 `-256color` 的正则分支 → level = 2
//     → 在 level 2 下 chalk.rgb() 会把颜色**降到 6×6×6 色立方里最接近的**
//     → Claude 的橙色 rgb(215,119,87) 被映射到 174 号 rgb(215,135,135)
//
//   最后那一步的后果：橙红变成「发白的肉粉色」。不是看不出来，
//   是品牌的识别色没了。这类 bug 很难被报成「颜色错误」——
//   用户只会说「感觉有点淡」。
//
// 【为什么判 `level === 2` 而不是 `level < 3`】
//   因为 level 0 是**用户明确要求不要颜色**（NO_COLOR、FORCE_COLOR=0）。
//   把它提到 3 等于无视用户的明确指令。
//   「能力不足」和「主动关闭」必须分开对待 —— 这是所有自动修正类代码
//   都要处理的一对：**修能力，不修意愿。**
//
// 【为什么必须在 tmux clamp 之前跑】
//   VS Code 里套 tmux 是真实场景。此时真相是「外层能显示真彩色，
//   但 tmux 转发不了」，所以最终应该停在 2。
//   先 boost 再 clamp，结果是对的；顺序反过来，clamp 看到 level 已经是 2
//   就不动了，然后再 boost 到 3 —— 最后变成真彩色，tmux 把那一段丢掉。
function boostChalkLevelForXtermJs(): boolean {
  if (process.env.TERM_PROGRAM === 'vscode' && chalk.level === 2) {
    chalk.level = 3
    return true
  }
  return false
}

/**
 * tmux parses truecolor SGR (\e[48;2;r;g;bm) into its cell buffer correctly,
 * but its client-side emitter only re-emits truecolor to the outer terminal if
 * the outer terminal advertises Tc/RGB capability (via terminal-overrides).
 * Default tmux config doesn't set this, so tmux emits the cell to iTerm2/etc
 * WITHOUT the bg sequence — outer terminal's buffer has bg=default → black on
 * dark profiles. Clamping to level 2 makes chalk emit 256-color (\e[48;5;Nm),
 * which tmux passes through cleanly. grey93 (255) is visually identical to
 * rgb(240,240,240).
 *
 * Users who HAVE set `terminal-overrides ,*:Tc` get a technically-unnecessary
 * downgrade, but the visual difference is imperceptible. Querying
 * `tmux show -gv terminal-overrides` to detect this would add a subprocess on
 * startup — not worth it.
 *
 * $TMUX is a pty-lifecycle env var set by tmux itself; it never comes from
 * globalSettings.env, so reading it here is correct. chalk is a singleton, so
 * this clamps ALL truecolor output (fg+bg+hex) across the entire app.
 */
// 第二段补丁：tmux。
//
//   机制值得完整理解，因为它解释了「为什么降级反而更准」：
//     tmux 解析真彩色 SGR **完全正确**（它自己的格子缓冲里有正确的 RGB）
//     但它往外层终端重新发射时，只在**外层终端声明了 Tc / RGB 能力**
//       的情况下才重发真彩色序列
//     而默认的 tmux 配置不带 terminal-overrides ,*:Tc
//     → 于是 tmux 发出去的内容里**没有背景色序列**
//     → 外层终端的格子是 bg=default
//     → 深色主题下就是一片黑底压黑字
//
//   降到 level 2 之后，chalk 发 256 色（索引色），tmux 原样转发。
//   grey93（索引 255）和 rgb(240,240,240) 在视觉上几乎一样 ——
//   这就是「降级没有代价」的前提：**调色板里有足够接近的替代品。**
//
// 【为什么不查 tmux 的真实能力】
//   `tmux show -gv terminal-overrides` 能拿到准确答案，但要在启动时
//   起一个子进程。注释里的判断是「不值得」——启动延迟是每个用户
//   都要付的成本，而这个信息只影响少数颜色精度。
//   **把一个准确的查询换成一个粗略的假设，前提是错的那一侧代价很小。**
//   这里错的代价是：已经配好 Tc 的人也降级到 256 色，视觉上察觉不到。
//
// 【注意 $TMUX 是 pty 生命周期变量】
//   tmux 自己设的，不会来自项目的 globalSettings.env。
//   这个区分很重要 —— 否则「用户在配置里写 TMUX=xxx」就会误触发降级。
function clampChalkLevelForTmux(): boolean {
  // bg.ts sets terminal-overrides :Tc before attach, so truecolor passes
  // through — skip the clamp. General escape hatch for anyone who's
  // configured their tmux correctly.
  if (process.env.CLAUDE_CODE_TMUX_TRUECOLOR) return false
  if (process.env.TMUX && chalk.level > 2) {
    chalk.level = 2
    return true
  }
  return false
}
// 这两行在**模块加载时**执行一次，结果缓存成常量。
//
//   理由：终端和 tmux 的环境不会在会话中途变。每次 colorize 都重新判断
//   是纯浪费 —— 而这个函数每帧要调几百次。
//
//   导出这两个布尔值是为了调试：出颜色问题时可以直接打印它们，
//   判断「是不是被这两段补丁改过」。注释里说 tree-shaken if unused ——
//   如果没有任何地方引用，打包时会消失，不占体积。
//
//   注意 chalk 是**单例**：这两段改的是全局状态，影响整个进程里
//   所有 chalk 调用（包括第三方库）。这是它们能生效的原因，
//   也是它们必须放在最前面（在任何颜色输出之前）的原因。
// Computed once at module load — terminal/tmux environment doesn't change mid-session.
// Order matters: boost first so the tmux clamp can re-clamp if tmux is running
// inside a VS Code terminal. Exported for debugging — tree-shaken if unused.
export const CHALK_BOOSTED_FOR_XTERMJS = boostChalkLevelForXtermJs()
export const CHALK_CLAMPED_FOR_TMUX = clampChalkLevelForTmux()

export type ColorType = 'foreground' | 'background'

// 两个正则都允许单个空格：`rgb( 1, 2, 3 )` 也认。
//   注意它们都没做**范围校验** —— rgb(300,-5,0) 会进入 chalk，
//   chalk 自己会怎么处理就不知道了（dtrace 到 ANSI 序列里再被终端裁）。
//   类型层面 RGBColor 是模板字面量，但运行时值可能来自配置文件。
const RGB_REGEX = /^rgb\(\s?(\d+),\s?(\d+),\s?(\d+)\s?\)$/
const ANSI_REGEX = /^ansi256\(\s?(\d+)\s?\)$/

// colorize：把「颜色字符串」变成「带 SGR 的文本」。
//
//   四种前缀依次判断：ansi: → # → ansi256 → rgb。
//   顺序上有两个必须满足的点：
//     · `ansi:` 必须最先判 —— 它是唯一带冒号的前缀，但把 `#` 放在它前面
//       也无害；真正的理由是「具名色」这一支最长（16 个 case），
//       放前面能快速排除掉所有 rgb()/hex 调用（它们会落到 startsWith 失败）
//     · `ansi256` 必须在 `rgb` 前 —— 两个前缀不重叠，顺序无实质影响，
//       但把「索引色」和「真彩色」分开判是这两类的本质区别
//
//   **未知颜色静默返回原串**（最后那个 return str）。这意味着
//   `color="ancient-red"` 这种拼写错误不会报错，只是没颜色。
//   选择静默的理由大概是「不能因为一个颜色值让整屏渲染失败」，
//   代价是「拼错了永远发现不了」。
export const colorize = (
  str: string,
  color: string | undefined,
  type: ColorType,
): string => {
  if (!color) {
    return str
  }

  if (color.startsWith('ansi:')) {
    const value = color.substring('ansi:'.length)
    switch (value) {
      case 'black':
        return type === 'foreground' ? chalk.black(str) : chalk.bgBlack(str)
      case 'red':
        return type === 'foreground' ? chalk.red(str) : chalk.bgRed(str)
      case 'green':
        return type === 'foreground' ? chalk.green(str) : chalk.bgGreen(str)
      case 'yellow':
        return type === 'foreground' ? chalk.yellow(str) : chalk.bgYellow(str)
      case 'blue':
        return type === 'foreground' ? chalk.blue(str) : chalk.bgBlue(str)
      case 'magenta':
        return type === 'foreground' ? chalk.magenta(str) : chalk.bgMagenta(str)
      case 'cyan':
        return type === 'foreground' ? chalk.cyan(str) : chalk.bgCyan(str)
      case 'white':
        return type === 'foreground' ? chalk.white(str) : chalk.bgWhite(str)
      case 'blackBright':
        return type === 'foreground'
          ? chalk.blackBright(str)
          : chalk.bgBlackBright(str)
      case 'redBright':
        return type === 'foreground'
          ? chalk.redBright(str)
          : chalk.bgRedBright(str)
      case 'greenBright':
        return type === 'foreground'
          ? chalk.greenBright(str)
          : chalk.bgGreenBright(str)
      case 'yellowBright':
        return type === 'foreground'
          ? chalk.yellowBright(str)
          : chalk.bgYellowBright(str)
      case 'blueBright':
        return type === 'foreground'
          ? chalk.blueBright(str)
          : chalk.bgBlueBright(str)
      case 'magentaBright':
        return type === 'foreground'
          ? chalk.magentaBright(str)
          : chalk.bgMagentaBright(str)
      case 'cyanBright':
        return type === 'foreground'
          ? chalk.cyanBright(str)
          : chalk.bgCyanBright(str)
      case 'whiteBright':
        return type === 'foreground'
          ? chalk.whiteBright(str)
          : chalk.bgWhiteBright(str)
    }
  }

// 十六进制。chalk.hex 会自己解析 #rgb / #rrggbb / #rrggbbaa，
//   所以这里不做校验 —— 非法值 chalk 会抛（或者静默？取决于版本）。
//   这是全文件唯一一个「把解析责任完全交给库」的分支。
  if (color.startsWith('#')) {
    return type === 'foreground'
      ? chalk.hex(color)(str)
      : chalk.bgHex(color)(str)
  }

  if (color.startsWith('ansi256')) {
    const matches = ANSI_REGEX.exec(color)

    if (!matches) {
      return str
    }

    const value = Number(matches[1])

    return type === 'foreground'
      ? chalk.ansi256(value)(str)
      : chalk.bgAnsi256(value)(str)
  }

  if (color.startsWith('rgb')) {
    const matches = RGB_REGEX.exec(color)

    if (!matches) {
      return str
    }

    const firstValue = Number(matches[1])
    const secondValue = Number(matches[2])
    const thirdValue = Number(matches[3])

    return type === 'foreground'
      ? chalk.rgb(firstValue, secondValue, thirdValue)(str)
      : chalk.bgRgb(firstValue, secondValue, thirdValue)(str)
  }

  return str
}

/**
 * Apply TextStyles to a string using chalk.
 * This is the inverse of parsing ANSI codes - we generate them from structured styles.
 * Theme resolution happens at component layer, not here.
 */
// applyTextStyles：结构化样式 → ANSI 字符串。**这是 colorize 的反向操作**，
//   而 colorize 是解析（字符串 → 结构化）。
//
// 【嵌套顺序是这个函数唯一的难点】
//   chalk 的每次调用都是「包一层」：后调的在外层。
//   而想要的效果是（从外到内）：
//       背景色 > 前景色 > 文字修饰
//   所以调用顺序必须反过来：
//       修饰先（inverse / strikethrough / underline / italic / bold / dim）
//       然后前景色
//       最后背景色
//
//   写成代码就是 185-217 行那个顺序。如果顺序反了会怎样：
//   背景色在内层时，SGR 序列变成「先设背景、后设前景、再设修饰」，
//   在大多数终端上视觉结果是一样的（SGR 是状态机，顺序无关）。
//   真正会出错的是**不支持的终端上的降级行为** —— 有些终端遇到
//   不认识的 SGR 会重置全部状态，此时嵌套顺序决定谁被重置掉。
//
// 【修饰项的内部顺序为什么是这样】
//   inverse 在最内层（最先应用），dim 在修饰里最外层（最后应用）。
//   这个顺序没有技术必要性 —— 都是独立的 SGR 码（1/2/3/4/7/9）。
//   它只是「从视觉影响大到小」的书写习惯。
//
// 【注意 bold 和 dim 同时为 true】
//   这里两个都会发（SGR 1 和 SGR 2）。而 Ansi.tsx 的 StyledText 里
//   两者是互斥的（dim 优先）。两处语义不一致 —— 但这一处是渲染
//   结构化样式，那一处是还原外部 ANSI 字符串，来源不同，可以接受。
export function applyTextStyles(text: string, styles: TextStyles): string {
  let result = text

  // Apply styles in reverse order of desired nesting.
  // chalk wraps text so later calls become outer wrappers.
  // Desired order (outermost to innermost):
  //   background > foreground > text modifiers
  // So we apply: text modifiers first, then foreground, then background last.

  if (styles.inverse) {
    result = chalk.inverse(result)
  }

  if (styles.strikethrough) {
    result = chalk.strikethrough(result)
  }

  if (styles.underline) {
    result = chalk.underline(result)
  }

  if (styles.italic) {
    result = chalk.italic(result)
  }

  if (styles.bold) {
    result = chalk.bold(result)
  }

  if (styles.dim) {
    result = chalk.dim(result)
  }

  if (styles.color) {
    // Color is now always a raw color value (theme resolution happens at component layer)
    result = colorize(result, styles.color, 'foreground')
  }

  if (styles.backgroundColor) {
    // backgroundColor is now always a raw color value
    result = colorize(result, styles.backgroundColor, 'background')
  }

  return result
}

/**
 * Apply a raw color value to text.
 * Theme resolution should happen at component layer, not here.
 */
// applyColor 是 colorize 的便捷包装：只做前景色，不做样式。
//   存在的理由大概是「调用点只想染个色，不想构造一个 TextStyles 对象」。
//
//   这个文件整体很小（231 行），但承载了两个真实世界的适配：
//   VS Code 的自报家门、tmux 的转发限制。**终端 UI 的复杂度大量集中在
//   「同一个语义在不同终端上要发不同的字节」这件事上。**
export function applyColor(text: string, color: Color | undefined): string {
  if (!color) {
    return text
  }
  return colorize(text, color, 'foreground')
}
