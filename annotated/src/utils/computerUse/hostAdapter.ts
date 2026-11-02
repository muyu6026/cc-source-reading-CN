// Computer Use 宿主适配器：构造并缓存一个进程级单例，把本机原生能力（日志、执行器、权限、像素校验等）适配成 MCP 宿主接口。
import type {
  ComputerUseHostAdapter,
  Logger,
} from '@ant/computer-use-mcp/types'
import { format } from 'util'
import { logForDebugging } from '../debug.js'
import { COMPUTER_USE_MCP_SERVER_NAME } from './common.js'
import { createCliExecutor } from './executor.js'
import { getChicagoEnabled, getChicagoSubGates } from './gates.js'
import { requireComputerUseSwift } from './swiftLoader.js'

// DebugLogger：把 MCP 宿主要求的各级日志（silly/debug/info/warn/error）转接到内部调试日志，统一带级别。
class DebugLogger implements Logger {
  silly(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'debug' })
  }
  debug(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'debug' })
  }
  info(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'info' })
  }
  warn(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'warn' })
  }
  error(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'error' })
  }
}

let cached: ComputerUseHostAdapter | undefined
// 进程级缓存：首个 CU 工具调用时构建一次，之后复用，避免重复加载原生模块。

/**
 * Process-lifetime singleton. Built once on first CU tool call; native modules
 * (both `@ant/computer-use-input` and `@ant/computer-use-swift`) are loaded
 * here via the executor factory, which throws on load failure — there is no
 * degraded mode.
 */
// 模块文档：单例在首个 CU 工具调用时构建；原生模块（@ant/computer-use-input 与 @ant/computer-use-swift）经由执行器工厂在此加载，加载失败会抛错，没有降级模式。
// 获取单例：命中缓存直接返回；否则现场装配 serverName、logger、executor、权限检查、子门控与像素裁剪等字段后缓存。
export function getComputerUseHostAdapter(): ComputerUseHostAdapter {
  if (cached) return cached
  cached = {
    serverName: COMPUTER_USE_MCP_SERVER_NAME,
    logger: new DebugLogger(),
    executor: createCliExecutor({
      getMouseAnimationEnabled: () => getChicagoSubGates().mouseAnimation,
      getHideBeforeActionEnabled: () => getChicagoSubGates().hideBeforeAction,
    }),
    ensureOsPermissions: async () => {
      const cu = requireComputerUseSwift()
      const accessibility = cu.tcc.checkAccessibility()
      const screenRecording = cu.tcc.checkScreenRecording()
      return accessibility && screenRecording
        ? { granted: true }
        : { granted: false, accessibility, screenRecording }
    },
// ensureOsPermissions：调原生 tcc 检查辅助功能与屏幕录制权限，二者皆通过才算授予，否则返回具体缺失项。
    isDisabled: () => !getChicagoEnabled(),
    getSubGates: getChicagoSubGates,
    // cleanup.ts always unhides at turn end — no user preference to disable it.
    getAutoUnhideEnabled: () => true,

    // Pixel-validation JPEG decode+crop. MUST be synchronous (the package
    // does `patch1.equals(patch2)` directly on the return value). Cowork uses
    // Electron's `nativeImage` (sync); our `image-processor-napi` is
    // sharp-compatible and async-only. Returning null → validation skipped,
    // click proceeds — the designed fallback per `PixelCompareResult.skipped`.
    // The sub-gate defaults to false anyway.
    cropRawPatch: () => null,
// cropRawPatch：像素校验的 JPEG 解码加裁剪；本实现必须同步，而我们用的库只异步，故返回 null 走「跳过校验、照常点击」的设计降级。
  }
  return cached
}
// 单例收尾：返回装配好的宿主适配器，之后所有 CU 工具复用同一实例，原生模块只加载一次。
