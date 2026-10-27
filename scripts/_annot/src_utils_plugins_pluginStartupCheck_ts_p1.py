ANNOTATIONS = [
    (27, 'after', '''插件启动期检查：跨设置源汇总启用插件、判定可写回范围、读取已安装列表并补齐缺失插件的安装。'''),
    (72, 'after', '''checkEnabledPlugins：以合并设置（策略>本地>项目>用户）覆盖 --add-dir 插件，是「是否启用」的权威判定。'''),
    (163, 'after', '''getPluginEditableScopes：计算每个启用插件所归属的、可由用户写回的设置范围，按优先级从低到高覆盖。'''),
    (174, 'after', '''isPersistableScope：session-only 的 flag 范围不持久化，其余范围写入 installed_plugins.json。'''),
    (209, 'after', '''getInstalledPlugins：读取已安装插件并触发 V1→V2 迁移，始终使用 V2 格式初始化内存会话状态。'''),
    (250, 'after', '''findMissingPlugins：对比启用与已安装，再并行到各市场查询确认真实存在，返回缺失插件清单。'''),
    (341, 'after', '''installSelectedPlugins：按范围逐个安装插件（外部缓存注册/本地直接注册），并在对应设置源标记为启用。'''),
]
