# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件按平台返回「托管设置目录」的固定位置（macOS 在 Library/Application Support/ClaudeCode、Windows 在 C 盘 Program Files 下的 ClaudeCode、其他系统落在 etc/claude-code），并提供其下 managed-settings.d 拆分目录的惰性取值。'''),
    (8, 'before', '''getManagedFilePath：用 memoize 包裹，按平台返回托管设置目录。Ant 专属且测试或演示用的环境变量 CLAUDE_CODE_MANAGED_SETTINGS_PATH 可整体覆盖（外部构建已剔除该分支）。'''),
    (32, 'before', '''getManagedSettingsDropInDir：返回托管设置目录下 managed-settings.d 拆分目录的路径；base 配置先合并，再按字母序叠加该目录中的 drop-in 文件（后者覆盖前者）。'''),
]
