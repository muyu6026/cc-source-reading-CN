# -*- coding: utf-8 -*-
slug = 'src_utils_plugins_cacheUtils_ts'
ANNOTATIONS = [
    (23, 'after', '''文件总述：插件缓存清理工具集，统一封装各类插件缓存（命令、代理、hook、选项、输出样式、zip）的清除，并处理孤儿版本目录的 7 天惰性清理。'''),
    (24, 'after', '''ORPHANED_AT_FILENAME 与 CLEANUP_AGE_MS：孤儿标记文件名与 7 天清理阈值（毫秒）。'''),
    (42, 'after', '''clearAllPluginCaches：清除全部插件缓存；pruneRemovedPluginHooks 只剪不增（新启用插件的 hook 留给 /reload-plugins 处理）。'''),
    (50, 'after', '''clearAllCaches：在插件缓存之上再清命令、代理定义、提示缓存、已发送技能名。'''),
    (64, 'after', '''markPluginVersionOrphaned：卸载或升级时写 .orphaned_at 时间戳标记孤儿版本，失败仅记调试日志。'''),
    (116, 'after', '''cleanupOrphanedPluginVersionsInBackground：两趟清理孤儿版本——先清已安装版本的标记，再对不在已装集合里的缓存版本补标或删除；zip 缓存模式下跳过整个清理以免把插件目录误删。'''),
    (120, 'after', '''getOrphanedAtPath：拼出某个版本目录下 .orphaned_at 的完整路径。'''),
    (131, 'after', '''removeOrphanedAtMarker：删除孤儿标记，ENOENT 视为已删除而忽略。'''),
    (147, 'after', '''getInstalledVersionPaths：从磁盘 installed_plugins.json 收集所有已装版本路径集合，失败返回 null 表示无法清理。'''),
    (177, 'after', '''processOrphanedPluginVersion：无标记则补标；标记存在且超过 7 天则递归删除整版本目录。'''),
    (187, 'after', '''removeIfEmpty：目录为空时递归删除。'''),
    (196, 'after', '''readSubdirs：仅列出子目录名，读不到目录时容错返回空数组。'''),
]
