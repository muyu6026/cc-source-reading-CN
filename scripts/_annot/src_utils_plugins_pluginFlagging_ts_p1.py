# source: src/utils/plugins/pluginFlagging.ts
ANNOTATIONS = [
    (24, 'after', '''被下架插件的记录文件名：flagged-plugins.json，放在插件目录下。'''),
    (29, 'after', '''FlaggedPlugin：记下被标记时间，seenAt 可选（标记已看到，用于 48 小时过期）。'''),
    (31, 'after', '''seenAt 过期窗口：自 seenAt 起 48 小时后，下次加载自动清除该条目。'''),
    (34, 'after', '''模块级缓存：首次异步调用（load 或 add）灌入，之后与写操作保持同步，供 React 渲染同步读取。'''),
    (40, 'after', '''parsePluginsData：把磁盘 JSON 解析成 {id: FlaggedPlugin}，形态不符或缺失字段则忽略。'''),
    (75, 'after', '''readFromDisk：读取并解析文件，读取失败（如文件不存在）返回空对象。'''),
    (88, 'after', '''writeToDisk：用随机临时文件加 rename 原子写入（权限 0600），写后刷新缓存；失败清理临时文件。'''),
    (117, 'after', '''loadFlaggedPlugins：从磁盘载入并清除过期的 seenAt 条目，须在 getFlaggedPlugins 之前 await。'''),
    (142, 'after', '''getFlaggedPlugins：直接返回内存缓存（未 load 过则返回空对象）。'''),
    (151, 'after', '''addFlaggedPlugin：把插件以 name@marketplace 形式加进标记表并落盘。'''),
    (174, 'after', '''markFlaggedPluginsSeen：Installed 视图渲染时调用，给未 seen 的条目补 seenAt（触发 48 小时过期计时）。'''),
    (199, 'after', '''removeFlaggedPlugin：用户在 /plugins 里忽略某条标记时调用，从表里删除并落盘。'''),
]
