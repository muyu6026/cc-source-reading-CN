# 批注数据：source/src/commands/doctor/index.ts
ANNOTATIONS = [
    (1, 'before', '''本文件定义 `doctor` 命令：诊断并校验 Claude Code 的安装与配置。
这里显式标注 `Command` 类型（而非 `satisfies`），写法与前几份略有不同。'''),
    (2, 'after', '''从 `envUtils` 引入 `isEnvTruthy`，把环境变量安全地解析为布尔值。'''),
    (6, 'after', '''`description` 说明命令用途：检查安装与设置是否正常。'''),
    (7, 'after', '''`isEnabled` 用 `!isEnvTruthy(DISABLE_DOCTOR_COMMAND)` 控制命令是否出现，
设置该环境变量为真即可隐藏 `doctor`，便于受限环境关闭自检。'''),
    (9, 'after', '''`load` 用动态 `import()` 懒加载实现，命令体按需进入主程序。'''),
]
