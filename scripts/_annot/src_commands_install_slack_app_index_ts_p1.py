# 批注数据：source/src/commands/install-slack-app/index.ts
ANNOTATIONS = [
    (1, 'before', '''本文件定义 `install-slack-app` 命令：安装 Claude 的 Slack 应用。
属于 `type: 'local'` 的后台命令。'''),
    (6, 'after', '''`description` 说明命令用途：把 Claude 接入 Slack 工作区。'''),
    (7, 'after', '''`availability: ['claude-ai']` 限定该命令只在 `claude-ai` 发行渠道中出现，
普通开源版看不到它。'''),
    (8, 'after', '''`supportsNonInteractive` 为 false，说明这条命令必须走交互流程，不能脚本化。'''),
    (9, 'after', '''`load` 用动态 `import()` 懒加载实现，主包不预先包含。'''),
]
