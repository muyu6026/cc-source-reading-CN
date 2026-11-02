// iTerm2 设置备份与恢复逻辑：安装或升级流程会先备份原 plist，失败时据此回滚，并维护「安装进行中」的标记。
import { copyFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { logError } from './log.js'

// `markITerm2SetupComplete` 把「安装进行中」标记置否，无论恢复成功与否都调用，确保状态不卡在中间。
export function markITerm2SetupComplete(): void {
  saveGlobalConfig(current => ({
    ...current,
    iterm2SetupInProgress: false,
  }))
}

// `getIterm2RecoveryInfo` 从全局配置读出恢复所需的两项信息：是否进行中与备份路径。
function getIterm2RecoveryInfo(): {
  inProgress: boolean
  backupPath: string | null
} {
  const config = getGlobalConfig()
  return {
    inProgress: config.iterm2SetupInProgress ?? false,
    backupPath: config.iterm2BackupPath || null,
  }
}

// `getITerm2PlistPath` 返回 iTerm2 偏好 plist 的固定位置（家目录下的 `Library/Preferences`）。
function getITerm2PlistPath(): string {
  return join(
    homedir(),
    'Library',
    'Preferences',
    'com.googlecode.iterm2.plist',
  )
}

type RestoreResult =
  | {
      status: 'restored' | 'no_backup'
    }
  | {
      status: 'failed'
      backupPath: string
    }

// `checkAndRestoreITerm2Backup` 是主入口：未在进行中或没有备份路径时直接判定无需恢复；否则校验备份存在后用它覆盖当前 plist。
export async function checkAndRestoreITerm2Backup(): Promise<RestoreResult> {
  const { inProgress, backupPath } = getIterm2RecoveryInfo()
  if (!inProgress) {
    return { status: 'no_backup' }
  }

  if (!backupPath) {
    markITerm2SetupComplete()
    return { status: 'no_backup' }
  }

  try {
    await stat(backupPath)
  } catch {
    markITerm2SetupComplete()
    return { status: 'no_backup' }
  }

  try {
    await copyFile(backupPath, getITerm2PlistPath())

    markITerm2SetupComplete()
    return { status: 'restored' }
  } catch (restoreError) {
    logError(
      new Error(`Failed to restore iTerm2 settings with: ${restoreError}`),
    )
    markITerm2SetupComplete()
    return { status: 'failed', backupPath }
  }
}
// 返回用可辨识联合表达三种结果（已恢复、无备份、失败），任何路径结束时都会清掉「进行中」标记，避免下次启动误判。
