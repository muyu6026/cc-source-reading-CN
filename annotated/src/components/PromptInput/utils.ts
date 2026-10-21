// ═══════════════════════════════════════════════════════════════
//  utils：输入框边上那三句提示语是怎么算出来的
// ═══════════════════════════════════════════════════════════════
//
//  60 行里有三个小函数，各自解决一个「同一件事在不同环境下说法不同」的问题：
//
//    isVimModeEnabled      —— 要不要走 vim 那套输入控件
//    getNewlineInstructions —— 换行到底该按什么键（三档递进）
//    isNonSpacePrintable   —— 这个按键算不算「用户真的打了个字」
//
//  第 2-4 行 import 的 terminalSetup 是关键：它把「用户装过 Shift+Enter 绑定没有」
//  这个外部事实带了进来，于是提示语能随环境变化，而不是永远印同一句话。
import {
  hasUsedBackslashReturn,
  isShiftEnterKeyBindingInstalled,
} from '../../commands/terminalSetup/terminalSetup.js'
import type { Key } from '../../ink.js'
import { getGlobalConfig } from '../../utils/config.js'
import { env } from '../../utils/env.js'
/**
 * Helper function to check if vim mode is currently enabled
 * @returns boolean indicating if vim mode is active
 */
// 【每次调用都读一遍全局配置，而且没有任何订阅】
//
//  这意味着：用户在会话中途 `/config` 打开 vim 模式，已经挂载的组件**不会**
//  因为这一行而重新渲染 —— 得靠别的地方触发重渲染（比如 AppState 变更），
//  这个函数才会在新的一轮渲染里读到新值。
//
//  为什么可以这么写：
//    · 它只在渲染期间被同步调用，不缓存结果，所以不会「读到旧值并一直用旧值」
//    · 真需要响应式的地方（比如设置界面）会显式订阅 settings
//
//  反过来说，这是个**读时生效、写时不通知**的典型：适合低频、只影响下次渲染的
//  开关；不适合「改了必须立刻看到变化」的状态。用错了就会出现「设置了但没反应」。
export function isVimModeEnabled(): boolean {
  const config = getGlobalConfig()
  return config.editorMode === 'vim'
}

// 【三档降级，而且最后一档还分「新手/老手」两种说法】
//
//  第 19 行 —— macOS 自带 Terminal.app：它自己就能把 Shift+Enter 识别成独立按键
//                （不需要任何绑定），所以直接说 shift + ⏎。
//  第 24 行 —— iTerm2 / VSCode：靠 terminalSetup 写过 keybinding，装过才敢这么说。
//  第 29 行 —— 其余终端：只能教「反斜杠 + 回车」这个笨办法。
//
//  第 29-31 行那个三元判断是**渐进式披露**：
//    用过的人看到 `\⏎ for newline`（一眼就懂，省空间）
//    没用过的人看到 `backslash (\) + return (⏎) for newline`（完整拼写）
//
//  这里有个容易忽略的正确性细节：判断「装没装」用的是 isShiftEnterKeyBindingInstalled()，
//  不是「是不是 iTerm2」—— 因为用户可能装了绑定又删了，也可能在 Terminal.app 里
//  自己装了一个。**问事实，别问身份。**
export function getNewlineInstructions(): string {
  // Apple Terminal on macOS uses native modifier key detection for Shift+Enter
  if (env.terminal === 'Apple_Terminal' && process.platform === 'darwin') {
    return 'shift + ⏎ for newline'
  }

  // For iTerm2 and VSCode, show Shift+Enter instructions if installed
  if (isShiftEnterKeyBindingInstalled()) {
    return 'shift + ⏎ for newline'
  }

  // Otherwise show backslash+return instructions
  return hasUsedBackslashReturn()
    ? '\\⏎ for newline'
    : 'backslash (\\) + return (⏎) for newline'
}

/**
 * True when the keystroke is a printable character that does not begin
 * with whitespace — i.e., a normal letter/digit/symbol the user typed.
 * Used to gate the lazy space inserted after an image pill.
 */
// 【十六个修饰键逐个排查，而不是一张表】
//
//  为什么不能写成「如果 input 长度是 1 且不是控制字符」：
//  Ink 的 Key 对象里，方向键、Home/End 这些**也可能**带着可打印字符
//  （比如某些终端把 PageUp 发成 ESC [ 5 ~ ，解析后 char 有值），只看长度会误判。
//
//  所以它选了最笨但最可靠的办法：把「不算打字」的键全列出来。漏一个的后果是
//  图片胶囊后面会凭空多出一个空格。
//
//  三个值得注意的地方：
//    1. **没有检查 key.shift** —— Shift+a 就是大写 A，当然算打字。
//    2. 第 59 行 `!/^\s/.test(input)` —— 开头是空白的输入（空格、Tab）不算，
//       因为那种情况下用户要的是缩进，不该再补空格。
//    3. 第 59 行 `!input.startsWith(ESC 字节)` —— 有些终端把无法识别的按键
//       原样透传成 ESC 开头的字节序列，这些不是用户打的字。
//
//  这个函数唯一的调用方是 PromptInput 的 lazySpaceInputFilter：
//  刚粘完一张图后，用户开始打字 → 在字前面补一个空格；按方向键 → 不补。
export function isNonSpacePrintable(input: string, key: Key): boolean {
  if (
    key.ctrl ||
    key.meta ||
    key.escape ||
    key.return ||
    key.tab ||
    key.backspace ||
    key.delete ||
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow ||
    key.pageUp ||
    key.pageDown ||
    key.home ||
    key.end
  ) {
    return false
  }
  return input.length > 0 && !/^\s/.test(input) && !input.startsWith('\x1b')
}
