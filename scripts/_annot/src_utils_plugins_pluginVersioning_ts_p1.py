# -*- coding: utf-8 -*-
SOURCE_PATH = 'src/utils/plugins/pluginVersioning.ts'
ANNOTATIONS = [
    (16, 'after', '''插件版本计算：按优先级（plugin.json 版本、调用方提供版本、git SHA、本地时间戳兜底）产出缓存路径与更新检测用的版本串。'''),
    (43, 'before', '''calculatePluginVersion 是版本计算主函数，依次尝试清单版本、提供版本、预解析 SHA、安装路径 SHA，全失败返回 unknown。'''),
    (106, 'after', '''calculatePluginVersion 结束：git-subdir 源会把子目录路径哈希进版本串，避免同提交不同子目录的插件在缓存里互相串台。'''),
    (114, 'before', '''getGitCommitSha 直接委托 getHeadForDir 取目录的提交 SHA。'''),
    (116, 'after', '''getGitCommitSha 结束。'''),
    (127, 'before', '''getVersionFromPath 从版本化缓存路径（.../plugins/cache/市场/插件/版本/）里抠出版本段。'''),
    (147, 'after', '''getVersionFromPath 结束：找不到 cache 标记或路径层级不够则返回 null。'''),
    (155, 'before', '''isVersionedPath 只是 getVersionFromPath 的非空判断包装，判断路径是否走版本化结构。'''),
    (157, 'after', '''isVersionedPath 结束。'''),
]
