/**
 * Minimal module for firing MDM subprocess reads without blocking the event loop.
 * Has minimal imports — only child_process, fs, and mdmConstants (which only imports os).
 *
 * Two usage patterns:
 * 1. Startup: startMdmRawRead() fires at main.tsx module evaluation, results consumed later via getMdmRawReadPromise()
 * 2. Poll/fallback: fireRawRead() creates a fresh read on demand (used by changeDetector and SDK entrypoint)
 *
 * Raw stdout is consumed by mdmSettings.ts via consumeRawReadResult().
 */
// 模块用途：在不阻塞事件循环的前提下触发 MDM（移动设备管理）子进程读取。导入极简，仅依赖 child_process、fs 与 mdmConstants（后者只引 os），保证能在 main.tsx 模块求值阶段尽早调用。

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import {
  getMacOSPlistPaths,
  MDM_SUBPROCESS_TIMEOUT_MS,
  PLUTIL_ARGS_PREFIX,
  PLUTIL_PATH,
  WINDOWS_REGISTRY_KEY_PATH_HKCU,
  WINDOWS_REGISTRY_KEY_PATH_HKLM,
  WINDOWS_REGISTRY_VALUE_NAME,
} from './constants.js'

export type RawReadResult = {
// 声明原始读取结果结构：plistStdouts 为 macOS 的 plist 输出数组（找不到时为 null），hklmStdout/hkcuStdout 为 Windows 注册表两项输出（找不到时为 null）。
  plistStdouts: Array<{ stdout: string; label: string }> | null
  hklmStdout: string | null
  hkcuStdout: string | null
}

let rawReadPromise: Promise<RawReadResult> | null = null
// 缓存启动期的 MDM 原始读取 Promise，避免重复触发子进程。

function execFilePromise(
// 封装 execFile 为 Promise：以 utf-8 编码执行命令，超时由 MDM_SUBPROCESS_TIMEOUT_MS 控制；出错时返回 code 1、stdout 空串，绝不抛异常。
  cmd: string,
  args: string[],
): Promise<{ stdout: string; code: number | null }> {
  return new Promise(resolve => {
    execFile(
      cmd,
      args,
      { encoding: 'utf-8', timeout: MDM_SUBPROCESS_TIMEOUT_MS },
      (err, stdout) => {
        // biome-ignore lint/nursery/noFloatingPromises: resolve() is not a floating promise
        resolve({ stdout: stdout ?? '', code: err ? 1 : 0 })
      },
    )
  })
}

/**
 * Fire fresh subprocess reads for MDM settings and return raw stdout.
 * On macOS: spawns plutil for each plist path in parallel, picks first winner.
 * On Windows: spawns reg query for HKLM and HKCU in parallel.
 * On Linux: returns empty (no MDM equivalent).
 */
// 按需触发一次全新的 MDM 子进程读取。macOS 并行跑各 plist 路径的 plutil、Windows 并行跑 reg query（HKLM 与 HKCU）、Linux 直接返回空——因为 Linux 没有对应的 MDM 机制。
export function fireRawRead(): Promise<RawReadResult> {
  return (async (): Promise<RawReadResult> => {
    if (process.platform === 'darwin') {
      const plistPaths = getMacOSPlistPaths()

      const allResults = await Promise.all(
        plistPaths.map(async ({ path, label }) => {
          // Fast-path: skip the plutil subprocess if the plist file does not
          // exist. Spawning plutil takes ~5ms even for an immediate ENOENT,
          // and non-MDM machines never have these files.
          // Uses synchronous existsSync to preserve the spawn-during-imports
          // invariant: execFilePromise must be the first await so plutil
          // spawns before the event loop polls (see main.tsx:3-4).
          if (!existsSync(path)) {
            return { stdout: '', label, ok: false }
          }
          const { stdout, code } = await execFilePromise(PLUTIL_PATH, [
            ...PLUTIL_ARGS_PREFIX,
            path,
          ])
          return { stdout, label, ok: code === 0 && !!stdout }
        }),
      )

      // First source wins (array is in priority order)
// 取第一个命中的 plist 来源（数组按优先级排序），其余丢弃。
      const winner = allResults.find(r => r.ok)
      return {
        plistStdouts: winner
          ? [{ stdout: winner.stdout, label: winner.label }]
          : [],
        hklmStdout: null,
        hkcuStdout: null,
      }
    }

    if (process.platform === 'win32') {
      const [hklm, hkcu] = await Promise.all([
        execFilePromise('reg', [
          'query',
          WINDOWS_REGISTRY_KEY_PATH_HKLM,
          '/v',
          WINDOWS_REGISTRY_VALUE_NAME,
        ]),
        execFilePromise('reg', [
          'query',
          WINDOWS_REGISTRY_KEY_PATH_HKCU,
          '/v',
          WINDOWS_REGISTRY_VALUE_NAME,
        ]),
      ])
      return {
        plistStdouts: null,
        hklmStdout: hklm.code === 0 ? hklm.stdout : null,
        hkcuStdout: hkcu.code === 0 ? hkcu.stdout : null,
      }
    }

    return { plistStdouts: null, hklmStdout: null, hkcuStdout: null }
// 非 macOS 也非 Windows（即 Linux）时直接返回全空结果。
  })()
}

/**
 * Fire raw subprocess reads once for startup. Called at main.tsx module evaluation.
 * Results are consumed via getMdmRawReadPromise().
 */
// 启动期只触发一次原始读取，在 main.tsx 模块求值阶段调用；结果通过 getMdmRawReadPromise 取用。
export function startMdmRawRead(): void {
  if (rawReadPromise) return
  rawReadPromise = fireRawRead()
}

/**
 * Get the startup promise. Returns null if startMdmRawRead() wasn't called.
 */
// 取出启动期的 MDM 读取 Promise；若 startMdmRawRead 从未调用则返回 null。
export function getMdmRawReadPromise(): Promise<RawReadResult> | null {
  return rawReadPromise
}
