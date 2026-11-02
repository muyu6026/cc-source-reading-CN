// 文件级批注：`swiftLoader.ts` 负责按需加载并缓存 macOS 原生的 `@ant/computer-use-swift` 模块，非 macOS 平台直接抛错。
import type { ComputerUseAPI } from '@ant/computer-use-swift'

// 模块级缓存：缓存已加载的原生接口，避免重复 `require` 带来的开销与状态不一致。
let cached: ComputerUseAPI | undefined

/**
 * Package's js/index.js reads COMPUTER_USE_SWIFT_NODE_PATH (baked by
 * build-with-plugins.ts on darwin targets, unset otherwise — falls through to
 * the node_modules prebuilds/ path). We cache the loaded native module.
 *
 * The four @MainActor methods (captureExcluding, captureRegion,
 * apps.listInstalled, resolvePrepareCapture) dispatch to DispatchQueue.main
 * and will hang under libuv unless CFRunLoop is pumped — call sites wrap
 * these in drainRunLoop().
 */
// 加载入口：先判平台，非 darwin 直接抛错，再用空值合并只加载一次并写回缓存。
export function requireComputerUseSwift(): ComputerUseAPI {
  if (process.platform !== 'darwin') {
    throw new Error('@ant/computer-use-swift is macOS-only')
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (cached ??= require('@ant/computer-use-swift') as ComputerUseAPI)
}
// 收尾：首次加载后缓存结果，后续调用直接复用同一实例。

export type { ComputerUseAPI }
// 收尾：把原生接口类型重新导出，方便其他模块按名引用。
