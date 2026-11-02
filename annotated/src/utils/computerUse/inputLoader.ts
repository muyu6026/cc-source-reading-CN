// 本文件惰性加载 computer-use-input 原生模块并缓存：包通过编译期注入的节点路径读取预构建产物，并一次性把「是否支持」判别式收窄成裸 API 供调用方使用。
import type {
  ComputerUseInput,
  ComputerUseInputAPI,
} from '@ant/computer-use-input'

// cached：模块级缓存，requireComputerUseInput 首次成功后缓存结果，避免重复加载原生模块。
let cached: ComputerUseInputAPI | undefined

/**
 * Package's js/index.js reads COMPUTER_USE_INPUT_NODE_PATH (baked by
 * build-with-plugins.ts on darwin targets, unset otherwise — falls through to
 * the node_modules prebuilds/ path).
 *
 * The package exports a discriminated union on `isSupported` — narrowed here
 * once so callers get the bare `ComputerUseInputAPI` without re-checking.
 *
 * key()/keys() dispatch enigo work onto DispatchQueue.main via
 * dispatch2::run_on_main, then block a tokio worker on a channel. Under
 * Electron (CFRunLoop drains the main queue) this works; under libuv
 * (Node/bun) the main queue never drains and the promise hangs. The executor
 * calls these inside drainRunLoop().
 */
// requireComputerUseInput：取缓存；否则动态 require 该包，若 isSupported 为 false 则抛错，否则缓存并返回裸 API。注意其底层在 libuv 环境下主队列不排空会导致 promise 挂起，调用方需包在 drainRunLoop 中。
export function requireComputerUseInput(): ComputerUseInputAPI {
  if (cached) return cached
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const input = require('@ant/computer-use-input') as ComputerUseInput
  if (!input.isSupported) {
    throw new Error('@ant/computer-use-input is not supported on this platform')
  }
  return (cached = input)
}
