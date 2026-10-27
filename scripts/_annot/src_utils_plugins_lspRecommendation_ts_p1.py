# -*- coding: utf-8 -*-
# src/utils/plugins/lspRecommendation.ts（375 行）批注数据
ANNOTATIONS = [
    (38, 'after', '''`LspPluginRecommendation` 是返回给调用方的推荐结构。'''),

    (41, 'after', '''`MAX_IGNORED_COUNT` 设定用户可忽略推荐的次数上限，超过则停止提示。'''),

    (48, 'after', '''判断市场是否官方（来自 Anthropic）以决定排序优先级。'''),

    (57, 'after', '''`LspInfo` 内部类型：扩展名集合与 LSP 命令。'''),

    (75, 'after', '''字符串路径形式的 `lspServers` 无法从市场读取，直接跳过。'''),

    (83, 'after', '''数组形式逐个尝试提取内联配置。'''),

    (100, 'after', '''`extractLspInfoFromManifest` 只读取内联配置，无法处理独立 `.lsp.json`。'''),

    (108, 'after', '''`isRecord` 类型守卫，判断值是否为普通对象。'''),

    (141, 'after', '''从内联配置记录中提取首个命令与全部扩展名。'''),

    (160, 'after', '''`getLspPluginsFromMarketplaces` 异步汇总所有已装市场的 LSP 插件。'''),

    (171, 'after', '''遍历每个市场插件，提取 LSP 信息并构建记录。'''),

    (184, 'after', '''用 `name@marketplace` 构造插件 ID 作为映射键。'''),

    (206, 'after', '''汇总函数结束，返回插件 ID 到信息的映射。'''),

    (222, 'after', '''`getMatchingLspPlugins` 主函数：为某文件路径匹配推荐插件。'''),

    (229, 'after', '''全局禁用推荐时直接返回空列表。'''),

    (236, 'after', '''无法提取文件扩展名时返回空列表。'''),

    (241, 'after', '''拉取所有市场的 LSP 插件。'''),

    (245, 'after', '''读取全局配置中的「永不推荐」列表。'''),

    (250, 'after', '''跳过未声明 `lspServers` 的插件。'''),

    (273, 'after', '''过滤：扩展名命中、不在永不列表、且尚未安装。'''),

    (290, 'after', '''再过滤：仅保留系统已安装对应 LSP 二进制的插件。'''),

    (298, 'after', '''排序：官方市场插件排在前面。'''),

    (308, 'after', '''映射为对外推荐结构并返回。'''),

    (316, 'after', '''`addToNeverSuggest` 把插件加入永不推荐列表。'''),

    (327, 'after', '''记录已加入永不推荐列表。'''),

    (334, 'after', '''`incrementIgnoredCount` 忽略计数加一。'''),

    (343, 'after', '''记录忽略计数已增加。'''),

    (357, 'after', '''`isLspRecommendationsDisabled` 判断推荐是否应禁用（显式关闭或忽略达上限）。'''),

    (374, 'after', '''`resetIgnoredCount` 重置忽略计数，便于用户重新开启推荐。'''),
]
