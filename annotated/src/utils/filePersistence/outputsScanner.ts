/**
 * Outputs directory scanner for file persistence
 *
 * This module provides utilities to:
 * - Detect the session type from environment variables
 * - Capture turn start timestamp
 * - Find modified files by comparing file mtimes against turn start time
 */
// outputs 目录扫描器：用于文件持久化场景。本模块负责依据环境变量判定会话环境类型、记录回合起始时间戳、并通过比对文件修改时间找出本回合被改动的文件。

import * as fs from 'fs/promises'
import * as path from 'path'
import { logForDebugging } from '../debug.js'
import type { EnvironmentKind } from '../teleport/environments.js'
import type { TurnStartTime } from './types.js'

/** Shared debug logger for file persistence modules */
export function logDebug(message: string): void {
  logForDebugging(`[file-persistence] ${message}`)
}
// logDebug：文件持久化模块的共享调试日志封装，统一在消息前加「[file-persistence]」前缀后交给通用调试日志。

/**
 * Get the environment kind from CLAUDE_CODE_ENVIRONMENT_KIND.
 * Returns null if not set or not a recognized value.
 */
export function getEnvironmentKind(): EnvironmentKind | null {
  const kind = process.env.CLAUDE_CODE_ENVIRONMENT_KIND
  if (kind === 'byoc' || kind === 'anthropic_cloud') {
    return kind
  }
  return null
}
// getEnvironmentKind：读取环境变量 CLAUDE_CODE_ENVIRONMENT_KIND，仅当值为「byoc」或「anthropic_cloud」时返回该值，否则返回 null。

function hasParentPath(
  entry: object,
): entry is { parentPath: string; name: string } {
  return 'parentPath' in entry && typeof entry.parentPath === 'string'
}
// hasParentPath：类型守卫，判断某个目录项是否带有 parentPath 字段（Node 20 以上 readdir 的递归模式会提供）。

function hasPath(entry: object): entry is { path: string; name: string } {
  return 'path' in entry && typeof entry.path === 'string'
}
// hasPath：另一个类型守卫，判断目录项是否带有 path 字段（旧版 readdir 提供）。

function getEntryParentPath(entry: object, fallback: string): string {
  if (hasParentPath(entry)) {
    return entry.parentPath
  }
  if (hasPath(entry)) {
    return entry.path
  }
  return fallback
}
// getEntryParentPath：优先取 parentPath，其次取 path，都没有则回退到调用方给的 fallback，用来拼出文件的完整路径。

/**
 * Find files that have been modified since the turn started.
 * Returns paths of files with mtime >= turnStartTime.
 *
 * Uses recursive directory listing and parallelized stat calls for efficiency.
 *
 * @param turnStartTime - The timestamp when the turn started
 * @param outputsDir - The directory to scan for modified files
 */
export async function findModifiedFiles(
  turnStartTime: TurnStartTime,
  outputsDir: string,
): Promise<string[]> {
// findModifiedFiles 签名：核心入口。传入回合起始时间戳与 outputs 目录，递归列出目录下全部文件并与回合起始时间比对，返回本回合被修改的文件路径列表。
  // Use recursive flag to get all entries in one call
  let entries: Awaited<ReturnType<typeof fs.readdir>>
  try {
    entries = await fs.readdir(outputsDir, {
      withFileTypes: true,
      recursive: true,
    })
  } catch {
    // Directory doesn't exist or is not accessible
    return []
  }
// 目录读取失败（不存在或无权限）时直接返回空数组，不抛错，保证上层调用安全。

  // Filter to regular files only (skip symlinks for security) and build full paths
  const filePaths: string[] = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue
    }
    if (entry.isFile()) {
      // entry.parentPath is available in Node 20+, fallback to entry.path for older versions
      const parentPath = getEntryParentPath(entry, outputsDir)
      filePaths.push(path.join(parentPath, entry.name))
    }
  }

  if (filePaths.length === 0) {
    logDebug('No files found in outputs directory')
    return []
  }
// 若递归列出的文件为空，记录调试日志并返回空数组，提前结束避免无谓的 stat 调用。

  // Parallelize stat calls for all files
  const statResults = await Promise.all(
    filePaths.map(async filePath => {
      try {
        const stat = await fs.lstat(filePath)
        // Skip if it became a symlink between readdir and stat (race condition)
        if (stat.isSymbolicLink()) {
          return null
        }
        return { filePath, mtimeMs: stat.mtimeMs }
      } catch {
        // File may have been deleted between readdir and stat
        return null
      }
    }),
  )

  // Filter to files modified since turn start
  const modifiedFiles: string[] = []
  for (const result of statResults) {
    if (result && result.mtimeMs >= turnStartTime) {
      modifiedFiles.push(result.filePath)
    }
  }

  logDebug(
    `Found ${modifiedFiles.length} modified files since turn start (scanned ${filePaths.length} total)`,
  )
// 比对完成：把修改时间大于等于回合起始时间的文件收集进结果，并输出调试日志说明扫描总数与命中数。

  return modifiedFiles
}
// 返回本回合被修改的文件路径列表给上层持久化逻辑使用。
