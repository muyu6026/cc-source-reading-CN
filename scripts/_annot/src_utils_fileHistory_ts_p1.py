# 数据文件：source/src/utils/fileHistory.ts
# slug = src_utils_fileHistory_ts
# 每个锚点：(行号, 'before'|'after'|'after_block', 中文批注)
# 约束：中文用三引号；正文禁英文双引号与反斜杠。

ANNOTATIONS = [
    (1, 'after', '''本模块实现「文件历史 / 检查点」：在每次文件编辑前给文件做个备份，从而可以把整个文件系统回滚到任意一条历史快照。核心设计：快照里只存「每个被追踪文件的某版本备份文件名」，备份实体放在配置目录下的 file-history 按会话分桶，从而支持会话续接时把旧会话的备份硬链接到新会话。'''),
    (31, 'after', '''BackupFileName 是 string 或 null：null 表示这个版本下该文件并不存在（文件删除也当作一种状态记录）。'''),
    (37, 'after', '''FileHistoryBackup 描述某文件在某快照里的一条备份：备份文件名、版本号、备份时间。'''),
    (43, 'after', '''FileHistorySnapshot 是一份快照：关联的消息 ID、被追踪文件的备份表、时间戳。'''),
    (52, 'after', '''FileHistoryState 是运行时状态：快照数组、被追踪文件集合，以及一个只增不减的快照序列号（供 useGitDiffStats 当作活跃度信号，因为快照数到上限会平台化）。'''),
    (54, 'after', '''MAX_SNAPSHOTS = 100 是内存里保留的快照上限。'''),
    (61, 'after', '''DiffStats 是回滚到某快照时的影响统计：改了哪些文件、增删行数，或 undefined。'''),
    (63, 'after', '''fileHistoryEnabled 判断是否启用文件历史：非交互会话走 SDK 开关；普通会话看全局配置与禁用环境变量，任一为真即开启。'''),
    (73, 'after', '''fileHistoryEnabledSdk 是 SDK 模式下的专用开关，需显式启用且未被禁用。'''),
    (92, 'after', '''fileHistoryTrackEdit 在「编辑或新增文件之前」调用：先给当前内容做个 v1 备份（若需要），并把文件登记进最近一份快照的追踪表。分三阶段：先无副作用地探一遍状态，再异步备份，最后在更新回调里提交，避免把确定性备份覆盖成编辑后的内容。'''),
    (202, 'after', '''fileHistoryMakeSnapshot 在每次请求后做快照：给所有被追踪且内容变化的文件重新备份，提交一份新快照（超过 MAX_SNAPSHOTS 只保留最近 100 份）。同样分探状态、异步备份、提交三阶段，提交时把 trackEdit 阶段可能新增的文件也继承进来。'''),
    (351, 'after', '''fileHistoryRewind 把文件系统回滚到指定快照：纯文件副作用，不改 FileHistoryState；找到目标快照后调用 applySnapshot 写或删磁盘文件，失败抛错。'''),
    (402, 'after', '''fileHistoryCanRestore 判断某消息是否已有快照可恢复，供 UI 决定要不要展示回滚入口。'''),
    (417, 'after', '''fileHistoryGetDiffStats 算「回滚到某快照会改多少」：对每个被追踪文件比较当前与快照备份，汇总增删行数与改动文件。'''),
    (497, 'after', '''fileHistoryHasAnyChanges 是轻量布尔判断：只回答「回滚会不会动任何文件」，复用 checkOriginFileChanged 的 stat/内容比较而不调 diffLines，遇到第一个改动就提前返回，给只关心 yes/no 的调用方省开销。'''),
    (540, 'after', '''applySnapshot 把快照真正落到磁盘：对每个被追踪文件，按备份决定写回某版本、删除（快照里该文件不存在）还是跳过（内容没变），返回改动文件路径。'''),
    (604, 'after', '''checkOriginFileChanged 比较原文件与备份是否不同：先做 stat 比较（权限、大小、修改时间），只有修改时间不早于备份时才比较内容，最后才读文件比对。可复用调用方已拿到的 stat 省一次系统调用。'''),
    (643, 'after', '''compareStatsAndContent 是 stat/内容比较的共享逻辑：一方缺失即视为改了；都缺失视为没改；权限或大小不同即改；原文件 mtime 早于备份则没改；否则才比内容。'''),
    (680, 'after', '''computeDiffStatsForFile 用 diffLines 算出单文件增删行数，供回滚预览展示。'''),
    (725, 'after', '''getBackupFileName 用文件路径的 sha256 前 16 位加版本号拼出确定性备份文件名，保证同一文件同版本文件名稳定。'''),
    (733, 'after', '''resolveBackupPath 把备份文件名解析成完整路径：配置目录/file-history/会话ID/文件名；不传会话 ID 就用当前会话。'''),
    (751, 'after', '''createBackup 给文件做备份：源文件缺失就记一条 null 备份（文件不存在标记）；否则用 copyFile 避免把整文件读进堆（旧方案对过大文件会 OOM），写完后保留原文件权限。懒建目录：先试 copyFile，ENOENT 再 mkdir 重试。'''),
    (807, 'after', '''restoreBackup 从备份恢复文件：先 stat 备份确认存在，懒建目标目录后 copyFile，再恢复权限。'''),
    (850, 'after', '''getBackupFileNameFirstVersion 找某文件最早的 v1 备份文件名（或 null 表示首版就不存在，或 undefined 表示找不到首版），用于回滚到一个还没追踪该文件的检查点。'''),
    (867, 'after', '''maybeShortenFilePath 用相对路径当追踪键以省空间：绝对路径且位于原始工作目录内就转成相对路径。'''),
    (878, 'after', '''maybeExpandFilePath 是上面的逆操作：相对路径拼回原始工作目录得到绝对路径。'''),
    (891, 'after', '''fileHistoryRestoreStateFromLog 从日志里的快照重建内存状态：把绝对路径迁移成缩短后的相对路径，重建被追踪文件集合与快照数组。'''),
    (922, 'after', '''copyFileHistoryForResume 在会话续接时把旧会话的备份硬链接（失败再拷贝）到新会话目录，使恢复能用上旧备份；按快照并行处理，只有全部备份迁移成功才记录该快照。'''),
    (1057, 'after', '''notifyVscodeSnapshotFilesUpdated 比较相邻两份快照，对在内容上有变化的文件向 VSCode 发 file_updated 通知（fire-and-forget），让编辑器刷新。'''),
    (1100, 'after', '''readFileAsyncOrNull 是吞掉所有错误的异步读，读不到就返回 null，用于尽力而为的辅助读取。'''),
    (1109, 'after', '''ENABLE_DUMP_STATE 默认关闭，maybeDumpStateForDebug 仅在开启时把状态 dump 出来便于调试。'''),
    (1110, 'after', '''maybeDumpStateForDebug 在开启调试开关时把文件历史状态打印出来。'''),
]
