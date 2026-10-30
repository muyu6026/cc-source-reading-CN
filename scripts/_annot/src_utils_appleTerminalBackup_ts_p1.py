# 批注数据：src/utils/appleTerminalBackup.ts
# slug: src_utils_appleTerminalBackup_ts
ANNOTATIONS = [
    (6, 'after', '''macOS Terminal 配置备份与恢复：在终端设置初始化前后备份 com.apple.Terminal.plist，若初始化中断可在下次启动时恢复，防止用户终端配置丢失。'''),
    (13, 'after', '''markTerminalSetupInProgress：把备份路径写入全局配置，并标记初始化进行中。'''),
    (20, 'after', '''markTerminalSetupComplete：清除初始化进行中标记。'''),
    (31, 'after', '''getTerminalRecoveryInfo：从全局配置读取初始化状态与备份路径，供恢复流程判断。'''),
    (35, 'after', '''getTerminalPlistPath：返回当前用户的 Terminal.plist 绝对路径。'''),
    (50, 'after', '''若 defaults export 退出码非 0，说明导出失败，直接返回 null 表示无备份。'''),
    (71, 'after', '''backupTerminalPreferences：用 defaults export 把当前 Terminal 配置导出为备份文件，并返回备份路径；任何环节失败都返回 null。'''),
    (80, 'after', '''RestoreResult：恢复结果的联合类型，可能是「已恢复」「无备份」或「失败（附备份路径）」。'''),
    (97, 'after', '''若备份文件不存在，清除进行中标记并返回「无备份」，不报错。'''),
    (124, 'after', '''checkAndRestoreTerminalBackup：核对初始化状态与备份，必要时用 defaults import 恢复并刷新 cfprefsd，最后清除进行中标记并返回结果。'''),
]
