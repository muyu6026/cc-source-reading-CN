# 批注数据：src/utils/filePersistence/outputsScanner.ts
# slug: src_utils_filePersistence_outputsScanner_ts
ANNOTATIONS = [
    (1, 'after', '''outputs 目录扫描器：用于文件持久化场景。本模块负责依据环境变量判定会话环境类型、记录回合起始时间戳、并通过比对文件修改时间找出本回合被改动的文件。'''),
    (19, 'after', '''logDebug：文件持久化模块的共享调试日志封装，统一在消息前加「[file-persistence]」前缀后交给通用调试日志。'''),
    (31, 'after', '''getEnvironmentKind：读取环境变量 CLAUDE_CODE_ENVIRONMENT_KIND，仅当值为「byoc」或「anthropic_cloud」时返回该值，否则返回 null。'''),
    (37, 'after', '''hasParentPath：类型守卫，判断某个目录项是否带有 parentPath 字段（Node 20 以上 readdir 的递归模式会提供）。'''),
    (41, 'after', '''hasPath：另一个类型守卫，判断目录项是否带有 path 字段（旧版 readdir 提供）。'''),
    (51, 'after', '''getEntryParentPath：优先取 parentPath，其次取 path，都没有则回退到调用方给的 fallback，用来拼出文件的完整路径。'''),
    (65, 'after', '''findModifiedFiles 签名：核心入口。传入回合起始时间戳与 outputs 目录，递归列出目录下全部文件并与回合起始时间比对，返回本回合被修改的文件路径列表。'''),
    (76, 'after', '''目录读取失败（不存在或无权限）时直接返回空数组，不抛错，保证上层调用安全。'''),
    (94, 'after', '''若递归列出的文件为空，记录调试日志并返回空数组，提前结束避免无谓的 stat 调用。'''),
    (123, 'after', '''比对完成：把修改时间大于等于回合起始时间的文件收集进结果，并输出调试日志说明扫描总数与命中数。'''),
    (126, 'after', '''返回本回合被修改的文件路径列表给上层持久化逻辑使用。'''),
]
