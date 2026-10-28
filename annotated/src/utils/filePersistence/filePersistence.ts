// 模块总览：回合结束时的文件持久化编排。
// 负责把 outputs 目录下被修改的文件上传到文件接口或查询文件标识，区分 BYOC 模式与云端一P模式；
// 只有公开接口/会话用户、且功能开关与运行环境都满足时才启用。
/**
 * File persistence orchestrator
 *
 * This module provides the main orchestration logic for persisting files
 * at the end of each turn:
 * - BYOC mode: Upload files to Files API and collect file IDs
 * - 1P/Cloud mode: Query Files API listDirectory for file IDs (rclone handles sync)
 */

import { feature } from 'bun:bundle'
import { join, relative } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  type FilesApiConfig,
  uploadSessionFiles,
} from '../../services/api/filesApi.js'
import { getCwd } from '../cwd.js'
import { errorMessage } from '../errors.js'
import { logError } from '../log.js'
import { getSessionIngressAuthToken } from '../sessionIngressAuth.js'
import {
  findModifiedFiles,
  getEnvironmentKind,
  logDebug,
} from './outputsScanner.js'
import {
  DEFAULT_UPLOAD_CONCURRENCY,
  type FailedPersistence,
  FILE_COUNT_LIMIT,
  type FilesPersistedEventData,
  OUTPUTS_SUBDIR,
  type PersistedFile,
  type TurnStartTime,
} from './types.js'

/**
 * Execute file persistence for modified files in the outputs directory.
 *
 * Assembles all config internally:
 * - Checks environment kind (CLAUDE_CODE_ENVIRONMENT_KIND)
 * - Retrieves session access token
 * - Requires CLAUDE_CODE_REMOTE_SESSION_ID for session ID
 *
 * @param turnStartTime - The timestamp when the turn started
 * @param signal - Optional abort signal for cancellation
 * @returns Event data, or null if not enabled or no files to persist
 */
export async function runFilePersistence(
  turnStartTime: TurnStartTime,
  signal?: AbortSignal,
): Promise<FilesPersistedEventData | null> {
  const environmentKind = getEnvironmentKind()
  if (environmentKind !== 'byoc') {
    return null
  }

  const sessionAccessToken = getSessionIngressAuthToken()
  if (!sessionAccessToken) {
    return null
  }

  const sessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  if (!sessionId) {
    logError(
      new Error(
        'File persistence enabled but CLAUDE_CODE_REMOTE_SESSION_ID is not set',
      ),
    )
    return null
  }

  const config: FilesApiConfig = {
    oauthToken: sessionAccessToken,
    sessionId,
  }

  const outputsDir = join(getCwd(), sessionId, OUTPUTS_SUBDIR)

  // Check if aborted
  if (signal?.aborted) {
    logDebug('Persistence aborted before processing')
    return null
  }
// 取消校验：若信号已中止，则直接返回空结果，不再处理任何文件。

  const startTime = Date.now()
  logEvent('tengu_file_persistence_started', {
    mode: environmentKind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  try {
    let result: FilesPersistedEventData
    if (environmentKind === 'byoc') {
      result = await executeBYOCPersistence(
        turnStartTime,
        config,
        outputsDir,
        signal,
      )
    } else {
      result = await executeCloudPersistence()
    }

    // Nothing to report
    if (result.files.length === 0 && result.failed.length === 0) {
      return null
    }

    const durationMs = Date.now() - startTime
    logEvent('tengu_file_persistence_completed', {
      success_count: result.files.length,
      failure_count: result.failed.length,
      duration_ms: durationMs,
      mode: environmentKind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    return result
  } catch (error) {
    logError(error)
    logDebug(`File persistence failed: ${error}`)

    const durationMs = Date.now() - startTime
    logEvent('tengu_file_persistence_completed', {
      success_count: 0,
      failure_count: 0,
      duration_ms: durationMs,
      mode: environmentKind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error:
        'exception' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    return {
      files: [],
      failed: [
        {
          filename: outputsDir,
          error: errorMessage(error),
        },
      ],
    }
  }
}
// 主入口：组装配置后，按运行环境分支到 BYOC 或云端持久化；
// 无文件可上报或异常时都返回 null 或仅记录失败，绝不抛到调用方。

/**
 * Execute BYOC mode persistence: scan local filesystem for modified files,
 * then upload to Files API.
 */
async function executeBYOCPersistence(
  turnStartTime: TurnStartTime,
  config: FilesApiConfig,
  outputsDir: string,
  signal?: AbortSignal,
): Promise<FilesPersistedEventData> {
  // Find modified files via local filesystem scan
  // Uses same directory structure as downloads: {cwd}/{sessionId}/outputs
  const modifiedFiles = await findModifiedFiles(turnStartTime, outputsDir)

  if (modifiedFiles.length === 0) {
    logDebug('No modified files to persist')
    return { files: [], failed: [] }
  }

  logDebug(`Found ${modifiedFiles.length} modified files`)

  if (signal?.aborted) {
    return { files: [], failed: [] }
  }

  // Enforce file count limit
  if (modifiedFiles.length > FILE_COUNT_LIMIT) {
    logDebug(
      `File count limit exceeded: ${modifiedFiles.length} > ${FILE_COUNT_LIMIT}`,
    )
    logEvent('tengu_file_persistence_limit_exceeded', {
      file_count: modifiedFiles.length,
      limit: FILE_COUNT_LIMIT,
    })
    return {
      files: [],
      failed: [
        {
          filename: outputsDir,
          error: `Too many files modified (${modifiedFiles.length}). Maximum: ${FILE_COUNT_LIMIT}.`,
        },
      ],
    }
  }

  const filesToProcess = modifiedFiles
    .map(filePath => ({
      path: filePath,
      relativePath: relative(outputsDir, filePath),
    }))
    .filter(({ relativePath }) => {
      // Security: skip files that resolve outside the outputs directory
      if (relativePath.startsWith('..')) {
        logDebug(`Skipping file outside outputs directory: ${relativePath}`)
        return false
      }
      return true
    })

  logDebug(`BYOC mode: uploading ${filesToProcess.length} files`)

  // Upload files in parallel
  const results = await uploadSessionFiles(
    filesToProcess,
    config,
    DEFAULT_UPLOAD_CONCURRENCY,
  )

  // Separate successful and failed uploads
  const persistedFiles: PersistedFile[] = []
  const failedFiles: FailedPersistence[] = []

  for (const result of results) {
    if (result.success) {
      persistedFiles.push({
        filename: result.path,
        file_id: result.fileId,
      })
    } else {
      failedFiles.push({
        filename: result.path,
        error: result.error,
      })
    }
  }

  logDebug(
    `BYOC persistence complete: ${persistedFiles.length} uploaded, ${failedFiles.length} failed`,
  )

  return {
    files: persistedFiles,
    failed: failedFiles,
  }
}
// BYOC 持久化：扫描本地修改文件，强制文件数量上限，过滤掉解析到目录外的文件，
// 再并发上传，最后把成功与失败结果分桶返回。

/**
 * Execute Cloud (1P) mode persistence.
 * TODO: Read file_id from xattr on output files. xattr-based file IDs are
 * currently being added for 1P environments.
 */
function executeCloudPersistence(): FilesPersistedEventData {
  logDebug('Cloud mode: xattr-based file ID reading not yet implemented')
  return { files: [], failed: [] }
}
// 云端一P持久化：目前尚未实现基于扩展属性的文件标识读取，先返回空结果占位。

/**
 * Execute file persistence and emit result via callback.
 * Handles errors internally.
 */
export async function executeFilePersistence(
  turnStartTime: TurnStartTime,
  signal: AbortSignal,
  onResult: (result: FilesPersistedEventData) => void,
): Promise<void> {
  try {
    const result = await runFilePersistence(turnStartTime, signal)
    if (result) {
      onResult(result)
    }
  } catch (error) {
    logError(error)
  }
}
// 带回调的封装：内部调用主入口，有结果就通过回调吐出，异常只在本地记录。

/**
 * Check if file persistence is enabled.
 * Requires: feature flag ON, valid environment kind, session access token,
 * and CLAUDE_CODE_REMOTE_SESSION_ID.
 * This ensures only public-api/sessions users trigger file persistence,
 * not normal Claude Code CLI users.
 */
export function isFilePersistenceEnabled(): boolean {
  if (feature('FILE_PERSISTENCE')) {
    return (
      getEnvironmentKind() === 'byoc' &&
      !!getSessionIngressAuthToken() &&
      !!process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    )
  }
  return false
}
// 启用判定：功能开关、运行环境、会话令牌、远程会话标识四项全部具备才认为开启，
// 保证只有公开接口/会话用户会触发持久化而非普通 CLI 用户。
