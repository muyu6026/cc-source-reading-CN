# -*- coding: utf-8 -*-
# src/utils/releaseNotes.ts（360 行）批注数据
ANNOTATIONS = [
    (13, 'after', '''`MAX_RELEASE_NOTES_SHOWN` 每次最多展示的版本更新条数。'''),

    (29, 'after', '''`CHANGELOG_URL` 指向 GitHub 上的变更日志页面。'''),

    (32, 'after', '''`RAW_CHANGELOG_URL` 指向可直读的原始变更日志文件。'''),

    (39, 'after', '''`getChangelogCachePath` 返回缓存文件路径（位于配置目录的 cache 下）。'''),

    (43, 'after', '''`changelogMemoryCache` 内存缓存，供同步渲染路径读取，避免重读磁盘。'''),

    (48, 'after', '''`_resetChangelogCacheForTesting` 仅供测试重置内存缓存。'''),

    (55, 'after', '''`migrateChangelogFromConfig` 把旧的配置内存储迁移到文件。'''),

    (76, 'after', '''迁移结束，删除已废弃的 `cachedChangelog` 配置字段。'''),

    (82, 'after', '''`fetchAndStoreChangelog` 后台抓取变更日志并写入缓存，不阻塞界面。'''),

    (91, 'after', '''非交互会话或禁用非必要流量时跳过网络请求。'''),

    (110, 'after', '''写入缓存文件并刷新抓取时间戳到配置。'''),

    (119, 'after', '''抓取函数结束。'''),

    (126, 'after', '''`getStoredChangelog` 异步读取缓存文件并填充内存缓存。'''),

    (139, 'after', '''读取结束，文件缺失时内存缓存置空并返回空串。'''),

    (147, 'after', '''`getStoredChangelogFromMemory` 同步只读内存缓存，供 React 渲染使用。'''),

    (149, 'after', '''同步读取结束。'''),

    (156, 'after', '''`parseChangelog` 把 Markdown 变更日志解析为版本号到条目数组的映射。'''),

    (164, 'after', '''按二级标题切分各版本区块，跳过文件头。'''),

    (183, 'after', '''抽取每个版本下以短横开头的要点行作为更新说明。'''),

    (196, 'after', '''解析结束，异常时记录日志并返回空对象。'''),

    (207, 'after', '''`getRecentReleaseNotes` 返回上次见过版本之后的更新说明。'''),

    (234, 'after', '''只保留比上次版本更新的条目，按新版在前排序并截断到上限。'''),

    (240, 'after', '''最近说明函数结束。'''),

    (249, 'after', '''`getAllReleaseNotes` 返回全部版本与说明，旧版本在前。'''),

    (276, 'after', '''全部说明函数结束。'''),

    (287, 'after', '''`checkForReleaseNotes` 判断是否有新说明并触发后台重新抓取。'''),

    (305, 'after', '''ant 构建使用构建时打包的 `VERSION_CHANGELOG`。'''),

    (312, 'after', '''版本变化或缺失缓存时后台重新抓取，不阻塞界面。'''),

    (327, 'after', '''检查函数结束，返回是否有更新说明与内容。'''),

    (335, 'after', '''`checkForReleaseNotesSync` 同步变体，仅供 React 渲染路径使用。'''),

    (360, 'after', '''同步检查结束。'''),
]
