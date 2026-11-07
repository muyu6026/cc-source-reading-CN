# 批注数据：source/src/commands/resume/index.ts
ANNOTATIONS = [
    (1, 'before', '''本文件定义 `resume` 命令：恢复（继续）一段之前的会话。
显式标注 `Command` 类型，最后默认导出。'''),
    (4, 'after', '''`type: 'local-jsx'` 表示命令会弹出本地界面来挑选要恢复的会话。'''),
    (7, 'after', '''`aliases: ['continue']` 让 `continue` 成为 `resume` 的等价别名。'''),
    (8, 'after', '''`argumentHint` 提示参数可以是会话 id 或搜索词，用中括号表示可选。'''),
    (9, 'after', '''`load` 用动态 `import()` 懒加载实现，主包不预先包含它。'''),
]
