# 批注数据：source/src/utils/shell/resolveDefaultShell.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。解析输入框 `!` 命令要用哪种默认 shell，平台统一默认 `bash`，不随 Windows 自动切到 PowerShell。'''),
    (13, 'after', '''先读设置项的 `defaultShell`，为空时回退到 `bash`；显式写明不自动翻到 PowerShell，是为了不破坏那些在 Windows 上已经配好 bash 钩子的老用户。'''),
]
