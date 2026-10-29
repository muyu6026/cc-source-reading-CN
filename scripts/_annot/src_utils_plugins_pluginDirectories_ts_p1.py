# 批注数据：src/utils/plugins/pluginDirectories.ts

ANNOTATIONS = [
    (1, 'after', '''本文件集中管理插件目录配置：通过命令行标志或环境变量在 plugins 与 cowork_plugins 间切换，
基础目录可被覆盖变量改写，是整个插件目录路径的唯一真相来源。'''),
    (20, 'after', '''引入创建目录、遍历、路径与配置目录等依赖，以及清除插件缓存所需的辅助函数。'''),
    (25, 'after', '''getPluginsDirectoryName 按优先级选目录名：先会话状态（命令行标志），再环境变量，最后默认 plugins。'''),
    (44, 'after', '''getPluginsDirectoryName 收尾：cowork 模式返回 cowork_plugins，否则返回默认名。'''),
    (46, 'after', '''getPluginsDirectory 计算插件目录完整路径：优先用覆盖变量（需展开波浪号），否则取配置目录加目录名。'''),
    (63, 'after', '''getPluginsDirectory 收尾：波浪号展开是为修复设置里经 env 传入时不会被 shell 展开的问题。'''),
    (65, 'after', '''getPluginSeedDirs 读取只读种子目录：客户可预置一份插件目录到容器镜像，
按平台分隔符分层，第一个命中的种子优先于主目录的克隆。'''),
    (90, 'after', '''getPluginSeedDirs 收尾：按平台路径分隔符拆分并逐条展开波浪号。'''),
    (100, 'after', '''pluginDataDirPath 拼出某插件的 data 目录纯路径，不做创建，供卸载对话框展示。'''),
    (102, 'after', '''getPluginDataDir 提供跨版本持久化的插件数据目录（环境变量 CLAUDE_PLUGIN_DATA 指向它），
与每次更新都会丢弃的安装缓存不同，仅最后一次作用域卸载才清除；同步创建目录以配合调用点。'''),
    (123, 'after', '''getPluginDataDir 收尾：同步创建目录，因它在 String.replace 内部被调用，改成异步会扩散到多处。'''),
    (160, 'after', '''getPluginDataDirSize 递归统计 data 目录大小供卸载确认，单条 broken 符号链接出错时跳过而不是整体失败。'''),
    (178, 'after', '''deletePluginDataDir 在最后一次作用域卸载时尽力清理，失败只记日志不抛异常，避免清理副作用被当成卸载失败。'''),
]
