// ═══════════════════════════════════════════════════════════════
//  超链接支持：先信库，再补名单
// ═══════════════════════════════════════════════════════════════
//
//  这是一个「包装一个已存在的探测库」的范例，形状值得记：
//
//    1. 先问库（`supports-hyperlinks` 是社区维护的，覆盖最广）
//    2. 库说不支持 → 再查自己的补充名单
//    3. 三个来源：TERM_PROGRAM、LC_TERMINAL、TERM
//
//  顺序不能反：库的判断更权威（它按终端实际行为测过），
//  自己的名单只是补漏。反过来会让「库说不支持而名单里有」的终端
//  被误判成支持 —— 那种情况通常是名单过宽。
//
//  为什么需要补名单：库的更新频率跟不上新终端。ghostty、Hyper 这些
//  比库的 release 周期新。代价是名单会过时（终端修好了不需要补，
//  或者被移除），所以名单里的每一项都该有「为什么它不在库里」的理由。
import supportsHyperlinksLib from 'supports-hyperlinks'

// Additional terminals that support OSC 8 hyperlinks but aren't detected by supports-hyperlinks.
// Checked against both TERM_PROGRAM and LC_TERMINAL (the latter is preserved inside tmux).
// 六个名字里有一个特别的：`iTerm2` **和** `iTerm.app` 都在。
//
//  因为 iTerm2 在不同版本里 TERM_PROGRAM 的值不一样（老版本报
//  `iTerm.app`，某些场景报 `iTerm2`）。这类「同一个终端多个名字」
//  在终端探测里极常见，名单必须穷举 —— 漏一个就是「在那台机器上
//  没链接」这种只在特定版本出现的 bug。
//
//  `Hyper` 大小写混排（不是 HYPER）是它真的这么设的。
export const ADDITIONAL_HYPERLINK_TERMINALS = [
  'ghostty',
  'Hyper',
  'kitty',
  'alacritty',
  'iTerm.app',
  'iTerm2',
]

type EnvLike = Record<string, string | undefined>

type SupportsHyperlinksOptions = {
  env?: EnvLike
  stdoutSupported?: boolean
}

/**
 * Returns whether stdout supports OSC 8 hyperlinks.
 * Extends the supports-hyperlinks library with additional terminal detection.
 * @param options Optional overrides for testing (env, stdoutSupported)
 */
// 两个参数都可注入（env / stdoutSupported）—— 这是**可测性**设计。
//
//  没有这两个参数的话，这个函数只能靠改 process.env 来测，
//  而改全局状态在并发测试里会互相干扰。
//
//  用 `??` 而不是 `||`（第 30 行）：`stdoutSupported: false` 是一个
//  **有意义的显式值**，`||` 会把它当成「没传」而去查库。
//  这是一个典型的「布尔参数必须用 ?? 读默认值」的例子。
export function supportsHyperlinks(
  options?: SupportsHyperlinksOptions,
): boolean {
  const stdoutSupported =
    options?.stdoutSupported ?? supportsHyperlinksLib.stdout
  if (stdoutSupported) {
    return true
  }

  const env = options?.env ?? process.env

  // Check for additional terminals not detected by supports-hyperlinks
  const termProgram = env['TERM_PROGRAM']
  if (termProgram && ADDITIONAL_HYPERLINK_TERMINALS.includes(termProgram)) {
    return true
  }

// `LC_TERMINAL` 是 iTerm2 设的（macOS 的 locale 变量命名习惯），
//  但它有一个特殊性质：**在 tmux 里保留**。
//
//  而 `TERM_PROGRAM` 在 tmux 里会被改写成 `'tmux'` —— 于是「在 tmux 里
//  用 iTerm2」这个最常见的组合，靠 TERM_PROGRAM 是探测不出来的。
//
//  这就是为什么要有第三个来源。三条来源的优先级无关（都是「命中即
//  true」），但它们**覆盖的场景不同**：
//    TERM_PROGRAM  → 直连终端
//    LC_TERMINAL   → tmux 内层
//    TERM          → kitty（它不设 TERM_PROGRAM）
  // LC_TERMINAL is set by some terminals (e.g. iTerm2) and preserved inside tmux,
  // where TERM_PROGRAM is overwritten to 'tmux'.
  const lcTerminal = env['LC_TERMINAL']
  if (lcTerminal && ADDITIONAL_HYPERLINK_TERMINALS.includes(lcTerminal)) {
    return true
  }

  // Kitty sets TERM=xterm-kitty
// `term?.includes('kitty')` 而不是 `=== 'xterm-kitty'` —— 因为 kitty
//  的 TERM 值有多种（`xterm-kitty`、`xterm-kitty-...`），而且
//  SSH 进去后可能被改成别的形式。
//
//  includes 的代价是可能误判（一个 TERM 叫 `my-kitty-clone` 的终端
//  也会命中）。但误判的后果只是「多发几个 OSC 8」—— 不支持的终端
//  会忽略它们。**低代价的误判可以容忍**，这是探测设计里常用的取舍。
  const term = env['TERM']
  if (term?.includes('kitty')) {
    return true
  }

  return false
}
