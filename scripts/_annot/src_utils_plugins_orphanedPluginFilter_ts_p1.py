ANNOTATIONS = [
    (1, 'after', '''文件级说明：为孤立（已标记 .orphaned_at）的插件旧版本提供 ripgrep 排除 glob 模式。'''),
    (26, 'after', '''会话级缓存：计算后冻结，仅显式 /reload-plugins 才清。'''),
    (28, 'after', '''getGlobExclusionsForPluginCache 文档：块注释说明入参与惰性回退路径。'''),
    (88, 'after', '''getGlobExclusionsForPluginCache 收尾：把每个标记目录转成 !**/<相对>/** 排除模式，ripgrep 全局用正斜杠。'''),
    (92, 'after', '''clearPluginCacheExclusions 收尾：清空排除缓存。'''),
    (109, 'after', '''pathsOverlap 收尾：判断两路径是否互为前缀，根目录特判。'''),
    (114, 'after', '''normalizeForCompare 收尾：win32 下小写化以兼容大小写不一致的缓存目录配置。'''),
]
