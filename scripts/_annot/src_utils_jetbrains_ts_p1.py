# -*- coding: utf-8 -*-
slug = 'src_utils_jetbrains_ts'
ANNOTATIONS = [
    (1, 'before', '''文件总述：JetBrains 系列 IDE 插件探测。按 IDE 名映射到各平台下的插件目录，检测 claude-code-jetbrains-plugin 是否安装，并提供带缓存的同步/异步查询。'''),
    (6, 'after', '''PLUGIN_PREFIX：我们要寻找的插件目录名。'''),
    (25, 'after', '''ideNameToDirMap：IDE 名到其目录名前缀模式的映射（如 pycharm 对应 PyCharm）。'''),
    (39, 'after', '''appData 与 localAppData 的兜底拼装：环境变量缺失时按用户主目录推算 AppData/Roaming 与 AppData/Local。'''),
    (82, 'after', '''buildCommonPluginDirectoryPaths：按平台（darwin/win32/linux）拼出候选插件根目录列表。'''),
    (107, 'after', '''注释点：Linux 是唯一没有 plugins 子目录的操作系统，因此直接收插件根目录。'''),
    (132, 'after', '''detectPluginDirectories：枚举真实存在的插件目录，接受符号链接（GNU stow 用户常软链配置目录），最后去重。'''),
    (148, 'after', '''isJetBrainsPluginInstalled：探测某个 IDE 类型是否装了该插件。'''),
    (169, 'after', '''isJetBrainsPluginInstalledMemoized：带 Promise 缓存的异步探测，避免重复枚举目录。'''),
    (180, 'after', '''isJetBrainsPluginInstalledCached：带 forceRefresh 的缓存封装，强制刷新时清掉两层缓存。'''),
    (191, 'after', '''isJetBrainsPluginInstalledCachedSync：同步取缓存结果（尚未解析完成时返回 false），用于状态检测等非异步场景。'''),
]
