import { createContext } from 'react'
import { EventEmitter } from '../events/emitter.js'
import type { TerminalQuerier } from '../terminal-querier.js'

export type Props = {
  /**
   * Stdin stream passed to `render()` in `options.stdin` or `process.stdin` by default. Useful if your app needs to handle user input.
   */
  readonly stdin: NodeJS.ReadStream

  /**
   * Ink exposes this function via own `<StdinContext>` to be able to handle Ctrl+C, that's why you should use Ink's `setRawMode` instead of `process.stdin.setRawMode`.
   * If the `stdin` stream passed to Ink does not support setRawMode, this function does nothing.
   */
  readonly setRawMode: (value: boolean) => void

  /**
   * A boolean flag determining if the current `stdin` supports `setRawMode`. A component using `setRawMode` might want to use `isRawModeSupported` to nicely fall back in environments where raw mode is not supported.
   */
  readonly isRawModeSupported: boolean

  readonly internal_exitOnCtrlC: boolean

  readonly internal_eventEmitter: EventEmitter

  /** Query the terminal and await responses (DECRQM, OSC 11, etc.).
   *  Null only in the never-reached default context value. */
  readonly internal_querier: TerminalQuerier | null
}

/**
 * `StdinContext` is a React context, which exposes input stream.
 */

const StdinContext = createContext<Props>({
  stdin: process.stdin,

  internal_eventEmitter: new EventEmitter(),
  setRawMode() {},
  isRawModeSupported: false,

  internal_exitOnCtrlC: true,
  internal_querier: null,
})
// 【默认值里有一个真的 EventEmitter】
//
// 这不是占位符：`new EventEmitter()` 是**模块级单例**，在 Ink 树外
// 调用 useInput 时，监听者会真实地挂到它上面。
//
// 后果：useInput 在树外不报错、不警告，只是永远收不到输入。
// 排查时的表现是「这个组件的键盘没反应」，而代码看起来完全正常。
//
// 三个 internal_ 字段（exitOnCtrlC / eventEmitter / querier）都是
// 内部约定，但 useInput、useTabStatus、useSelection 全都依赖它们 ——
// 公开 API 建在未公开字段上，这在库里很常见，代价是重构时没有
// 类型层面的保护（它们只是 StdinContext 的字段，改名就全改）。

// eslint-disable-next-line custom-rules/no-top-level-side-effects
StdinContext.displayName = 'InternalStdinContext'

export default StdinContext
