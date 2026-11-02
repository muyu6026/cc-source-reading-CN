# -*- coding: utf-8 -*-
"""src/utils/iTermBackup.ts 的中文批注数据。"""

ANNOTATIONS = [
    (1, 'before', '''iTerm2 设置备份与恢复逻辑：安装或升级流程会先备份原 plist，失败时据此回滚，并维护「安装进行中」的标记。'''),
    (7, 'before', '''`markITerm2SetupComplete` 把「安装进行中」标记置否，无论恢复成功与否都调用，确保状态不卡在中间。'''),
    (14, 'before', '''`getIterm2RecoveryInfo` 从全局配置读出恢复所需的两项信息：是否进行中与备份路径。'''),
    (25, 'before', '''`getITerm2PlistPath` 返回 iTerm2 偏好 plist 的固定位置（家目录下的 `Library/Preferences`）。'''),
    (43, 'before', '''`checkAndRestoreITerm2Backup` 是主入口：未在进行中或没有备份路径时直接判定无需恢复；否则校验备份存在后用它覆盖当前 plist。'''),
    (73, 'after', '''返回用可辨识联合表达三种结果（已恢复、无备份、失败），任何路径结束时都会清掉「进行中」标记，避免下次启动误判。'''),
]
