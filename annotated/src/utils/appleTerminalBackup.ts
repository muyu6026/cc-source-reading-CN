import { stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { logError } from './log.js'
// macOS Terminal 配置备份与恢复：在终端设置初始化前后备份 com.apple.Terminal.plist，若初始化中断可在下次启动时恢复，防止用户终端配置丢失。
export function markTerminalSetupInProgress(backupPath: string): void {
  saveGlobalConfig(current => ({
    ...current,
    appleTerminalSetupInProgress: true,
    appleTerminalBackupPath: backupPath,
  }))
}
// markTerminalSetupInProgress：把备份路径写入全局配置，并标记初始化进行中。

export function markTerminalSetupComplete(): void {
  saveGlobalConfig(current => ({
    ...current,
    appleTerminalSetupInProgress: false,
  }))
}
// markTerminalSetupComplete：清除初始化进行中标记。

function getTerminalRecoveryInfo(): {
  inProgress: boolean
  backupPath: string | null
} {
  const config = getGlobalConfig()
  return {
    inProgress: config.appleTerminalSetupInProgress ?? false,
    backupPath: config.appleTerminalBackupPath || null,
  }
}
// getTerminalRecoveryInfo：从全局配置读取初始化状态与备份路径，供恢复流程判断。

export function getTerminalPlistPath(): string {
  return join(homedir(), 'Library', 'Preferences', 'com.apple.Terminal.plist')
}
// getTerminalPlistPath：返回当前用户的 Terminal.plist 绝对路径。

export async function backupTerminalPreferences(): Promise<string | null> {
  const terminalPlistPath = getTerminalPlistPath()
  const backupPath = `${terminalPlistPath}.bak`

  try {
    const { code } = await execFileNoThrow('defaults', [
      'export',
      'com.apple.Terminal',
      terminalPlistPath,
    ])

    if (code !== 0) {
      return null
    }
// 若 defaults export 退出码非 0，说明导出失败，直接返回 null 表示无备份。

    try {
      await stat(terminalPlistPath)
    } catch {
      return null
    }

    await execFileNoThrow('defaults', [
      'export',
      'com.apple.Terminal',
      backupPath,
    ])

    markTerminalSetupInProgress(backupPath)

    return backupPath
  } catch (error) {
    logError(error)
    return null
  }
}
// backupTerminalPreferences：用 defaults export 把当前 Terminal 配置导出为备份文件，并返回备份路径；任何环节失败都返回 null。

type RestoreResult =
  | {
      status: 'restored' | 'no_backup'
    }
  | {
      status: 'failed'
      backupPath: string
    }
// RestoreResult：恢复结果的联合类型，可能是「已恢复」「无备份」或「失败（附备份路径）」。

export async function checkAndRestoreTerminalBackup(): Promise<RestoreResult> {
  const { inProgress, backupPath } = getTerminalRecoveryInfo()
  if (!inProgress) {
    return { status: 'no_backup' }
  }

  if (!backupPath) {
    markTerminalSetupComplete()
    return { status: 'no_backup' }
  }

  try {
    await stat(backupPath)
  } catch {
    markTerminalSetupComplete()
    return { status: 'no_backup' }
// 若备份文件不存在，清除进行中标记并返回「无备份」，不报错。
  }

  try {
    const { code } = await execFileNoThrow('defaults', [
      'import',
      'com.apple.Terminal',
      backupPath,
    ])

    if (code !== 0) {
      return { status: 'failed', backupPath }
    }

    await execFileNoThrow('killall', ['cfprefsd'])

    markTerminalSetupComplete()
    return { status: 'restored' }
  } catch (restoreError) {
    logError(
      new Error(
        `Failed to restore Terminal.app settings with: ${restoreError}`,
      ),
    )
    markTerminalSetupComplete()
    return { status: 'failed', backupPath }
  }
}
// checkAndRestoreTerminalBackup：核对初始化状态与备份，必要时用 defaults import 恢复并刷新 cfprefsd，最后清除进行中标记并返回结果。
