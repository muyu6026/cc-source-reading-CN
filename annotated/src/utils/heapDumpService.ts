/**
 * Service for heap dump capture.
 * Used by the /heapdump command.
 */

import { createWriteStream, writeFileSync } from 'fs'
import { readdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import {
  getHeapSnapshot,
  getHeapSpaceStatistics,
  getHeapStatistics,
  type HeapSpaceInfo,
} from 'v8'
import { getSessionId } from '../bootstrap/state.js'
import { logEvent } from '../services/analytics/index.js'
import { logForDebugging } from './debug.js'
import { toError } from './errors.js'
import { getDesktopPath } from './file.js'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'
import { jsonStringify } from './slowOperations.js'

// HeapDumpResult：堆转储操作的结果类型，成功时返回堆快照与诊断文件路径，失败时返回错误信息。
export type HeapDumpResult = {
  success: boolean
  heapPath?: string
  diagPath?: string
  error?: string
}

/**
 * Memory diagnostics captured alongside heap dump.
 * Helps identify if leak is in V8 heap (captured in snapshot) or native memory (not captured).
 */
// MemoryDiagnostics：与堆快照一起采集的内存诊断结构，用于区分泄漏发生在 V8 堆内还是原生内存中。
export type MemoryDiagnostics = {
  timestamp: string
  sessionId: string
  trigger: 'manual' | 'auto-1.5GB'
  dumpNumber: number // 1st, 2nd, etc. auto dump in this session (0 for manual)
  uptimeSeconds: number
  memoryUsage: {
    heapUsed: number
    heapTotal: number
    external: number
    arrayBuffers: number
    rss: number
  }
  memoryGrowthRate: {
    bytesPerSecond: number
    mbPerHour: number
  }
  v8HeapStats: {
    heapSizeLimit: number // Max heap size allowed
    mallocedMemory: number // Memory allocated outside V8 heap
    peakMallocedMemory: number // Peak native memory
    detachedContexts: number // Leaked contexts - key leak indicator!
    nativeContexts: number // Active contexts
  }
  v8HeapSpaces?: Array<{
    name: string
    size: number
    used: number
    available: number
  }>
  resourceUsage: {
    maxRSS: number // Peak RSS in bytes
    userCPUTime: number
    systemCPUTime: number
  }
  activeHandles: number // Leaked timers, sockets, file handles
  activeRequests: number // Pending async operations
  openFileDescriptors?: number // Linux/macOS - indicates resource leaks
  analysis: {
    potentialLeaks: string[]
    recommendation: string
  }
  smapsRollup?: string // Linux only - detailed memory breakdown
  platform: string
  nodeVersion: string
  ccVersion: string
}

/**
 * Capture memory diagnostics.
 * This helps identify if the leak is in V8 heap (captured) or native memory (not captured).
 */
// captureMemoryDiagnostics：采集当前进程的内存诊断快照，包括堆统计、句柄数、文件描述符、泄漏指标与增长速率。
export async function captureMemoryDiagnostics(
  trigger: 'manual' | 'auto-1.5GB',
  dumpNumber = 0,
): Promise<MemoryDiagnostics> {
  const usage = process.memoryUsage()
  const heapStats = getHeapStatistics()
  const resourceUsage = process.resourceUsage()
  const uptimeSeconds = process.uptime()

  // getHeapSpaceStatistics() is not available in Bun
  let heapSpaceStats: HeapSpaceInfo[] | undefined
  try {
    heapSpaceStats = getHeapSpaceStatistics()
  } catch {
    // Not available in Bun runtime
  }

  // Get active handles/requests count (these are internal APIs but stable)
  const activeHandles = (
    process as unknown as { _getActiveHandles: () => unknown[] }
  )._getActiveHandles().length
  const activeRequests = (
    process as unknown as { _getActiveRequests: () => unknown[] }
  )._getActiveRequests().length

  // Try to count open file descriptors (Linux/macOS)
  let openFileDescriptors: number | undefined
  try {
    openFileDescriptors = (await readdir('/proc/self/fd')).length
  } catch {
    // Not on Linux - try macOS approach would require lsof, skip for now
  }

  // Try to read Linux smaps_rollup for detailed memory breakdown
  let smapsRollup: string | undefined
  try {
    smapsRollup = await readFile('/proc/self/smaps_rollup', 'utf8')
  } catch {
    // Not on Linux or no access - this is fine
  }

  // Calculate native memory (RSS - heap) and growth rate
  const nativeMemory = usage.rss - usage.heapUsed
  const bytesPerSecond = uptimeSeconds > 0 ? usage.rss / uptimeSeconds : 0
  const mbPerHour = (bytesPerSecond * 3600) / (1024 * 1024)

  // Identify potential leaks
  const potentialLeaks: string[] = []
  if (heapStats.number_of_detached_contexts > 0) {
// 若检测到游离上下文（detached contexts）数量大于零，记录为可能的 iframe 或上下文泄漏。
    potentialLeaks.push(
      `${heapStats.number_of_detached_contexts} detached context(s) - possible iframe/context leak`,
    )
  }
  if (activeHandles > 100) {
    potentialLeaks.push(
      `${activeHandles} active handles - possible timer/socket leak`,
    )
  }
  if (nativeMemory > usage.heapUsed) {
    potentialLeaks.push(
      'Native memory > heap - leak may be in native addons (node-pty, sharp, etc.)',
    )
  }
  if (mbPerHour > 100) {
    potentialLeaks.push(
      `High memory growth rate: ${mbPerHour.toFixed(1)} MB/hour`,
    )
  }
  if (openFileDescriptors && openFileDescriptors > 500) {
    potentialLeaks.push(
      `${openFileDescriptors} open file descriptors - possible file/socket leak`,
    )
  }

  return {
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
    trigger,
    dumpNumber,
    uptimeSeconds,
    memoryUsage: {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
      rss: usage.rss,
    },
    memoryGrowthRate: {
      bytesPerSecond,
      mbPerHour,
    },
    v8HeapStats: {
      heapSizeLimit: heapStats.heap_size_limit,
      mallocedMemory: heapStats.malloced_memory,
      peakMallocedMemory: heapStats.peak_malloced_memory,
      detachedContexts: heapStats.number_of_detached_contexts,
      nativeContexts: heapStats.number_of_native_contexts,
    },
    v8HeapSpaces: heapSpaceStats?.map(space => ({
      name: space.space_name,
      size: space.space_size,
      used: space.space_used_size,
      available: space.space_available_size,
    })),
    resourceUsage: {
      maxRSS: resourceUsage.maxRSS * 1024, // Convert KB to bytes
      userCPUTime: resourceUsage.userCPUTime,
      systemCPUTime: resourceUsage.systemCPUTime,
    },
    activeHandles,
    activeRequests,
    openFileDescriptors,
    analysis: {
      potentialLeaks,
      recommendation:
        potentialLeaks.length > 0
          ? `WARNING: ${potentialLeaks.length} potential leak indicator(s) found. See potentialLeaks array.`
          : 'No obvious leak indicators. Check heap snapshot for retained objects.',
    },
    smapsRollup,
    platform: process.platform,
    nodeVersion: process.version,
    ccVersion: MACRO.VERSION,
// 把当前 CC 版本号写入诊断信息，便于事后对照排查内存问题对应的构建版本。
  }
}

/**
 * Core heap dump function — captures heap snapshot + diagnostics to ~/Desktop.
 *
 * Diagnostics are written BEFORE the heap snapshot is captured, because the
 * V8 heap snapshot serialization can crash for very large heaps. By writing
 * diagnostics first, we still get useful memory info even if the snapshot fails.
 */
// performHeapDump：核心堆转储函数，先写诊断文件再抓堆快照，因为大堆快照序列化可能崩溃，先落盘诊断可保底。
export async function performHeapDump(
  trigger: 'manual' | 'auto-1.5GB' = 'manual',
  dumpNumber = 0,
): Promise<HeapDumpResult> {
  try {
    const sessionId = getSessionId()

    // Capture diagnostics before any other async I/O —
    // the heap dump itself allocates memory and would skew the numbers.
    const diagnostics = await captureMemoryDiagnostics(trigger, dumpNumber)

    const toGB = (bytes: number): string =>
      (bytes / 1024 / 1024 / 1024).toFixed(3)
    logForDebugging(`[HeapDump] Memory state:
  heapUsed: ${toGB(diagnostics.memoryUsage.heapUsed)} GB (in snapshot)
  external: ${toGB(diagnostics.memoryUsage.external)} GB (NOT in snapshot)
  rss: ${toGB(diagnostics.memoryUsage.rss)} GB (total process)
  ${diagnostics.analysis.recommendation}`)

    const dumpDir = getDesktopPath()
    await getFsImplementation().mkdir(dumpDir)

    const suffix = dumpNumber > 0 ? `-dump${dumpNumber}` : ''
    const heapFilename = `${sessionId}${suffix}.heapsnapshot`
    const diagFilename = `${sessionId}${suffix}-diagnostics.json`
    const heapPath = join(dumpDir, heapFilename)
    const diagPath = join(dumpDir, diagFilename)

    // Write diagnostics first (cheap, unlikely to fail)
    await writeFile(diagPath, jsonStringify(diagnostics, null, 2), {
// 先以 0o600 权限写入诊断 JSON（成本低、不易失败），再尝试写入堆快照。
      mode: 0o600,
    })
    logForDebugging(`[HeapDump] Diagnostics written to ${diagPath}`)

    // Write heap snapshot (this can crash for very large heaps)
    await writeHeapSnapshot(heapPath)
    logForDebugging(`[HeapDump] Heap dump written to ${heapPath}`)

    logEvent('tengu_heap_dump', {
      triggerManual: trigger === 'manual',
      triggerAuto15GB: trigger === 'auto-1.5GB',
      dumpNumber,
      success: true,
    })

    return { success: true, heapPath, diagPath }
  } catch (err) {
    const error = toError(err)
    logError(error)
    logEvent('tengu_heap_dump', {
      triggerManual: trigger === 'manual',
      triggerAuto15GB: trigger === 'auto-1.5GB',
      dumpNumber,
      success: false,
    })
    return { success: false, error: error.message }
  }
}

/**
 * Write heap snapshot to a file.
 * Uses pipeline() which handles stream cleanup automatically on errors.
 */
// writeHeapSnapshot：把堆快照写入文件，Bun 与 Node 走不同实现，用 pipeline 自动处理流清理。
async function writeHeapSnapshot(filepath: string): Promise<void> {
  if (typeof Bun !== 'undefined') {
// 在 Bun 环境下堆快照不支持流式，改用同步写入以避免跨线程克隆大字符串。
    // In Bun, heapsnapshots are currently not streaming.
    // Use synchronous I/O despite potentially large filesize so that we avoid cloning the string for cross-thread usage.
    //
    /* eslint-disable custom-rules/no-sync-fs -- intentionally sync to avoid cloning large heap snapshot string for cross-thread usage */
    // @ts-expect-error 2nd argument is in the next version of Bun
    writeFileSync(filepath, Bun.generateHeapSnapshot('v8', 'arraybuffer'), {
      mode: 0o600,
    })
    /* eslint-enable custom-rules/no-sync-fs */

    // Force GC to try to free that heap snapshot sooner.
    Bun.gc(true)
    return
  }
  const writeStream = createWriteStream(filepath, { mode: 0o600 })
// Node 环境下用 createWriteStream 配合 pipeline 把 V8 堆快照流式写入目标文件。
  const heapSnapshotStream = getHeapSnapshot()
  await pipeline(heapSnapshotStream, writeStream)
}
