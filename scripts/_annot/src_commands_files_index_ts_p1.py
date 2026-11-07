# 批注数据：source/src/commands/files/index.ts
ANNOTATIONS = [
    (1, 'before', '''本文件定义 `files` 命令：列出当前上下文里所有已加载的文件。
同样是 `type: 'local'` 的无界面后台命令。'''),
    (6, 'after', '''`description` 说明命令会罗列当前已进入上下文的全部文件。'''),
    (7, 'after', '''`isEnabled` 同样仅在 `USER_TYPE` 等于 `ant` 时启用，属内部命令。'''),
    (8, 'after', '''`supportsNonInteractive` 为真，命令可脱离交互模式运行。'''),
    (9, 'after', '''`load` 用动态 `import()` 按需加载实现，避免拖慢启动。'''),
]
