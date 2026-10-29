# 数据文件：src/utils/plugins/hintRecommendation.ts
SOURCE_PATH = 'src/utils/plugins/hintRecommendation.ts'
ANNOTATIONS = [
    (31, 'after', """文件入口：插件安装提示推荐，由 CLI / SDK 输出的 claude-code-hint 标签触发。"""),
    (39, 'after', """MAX_SHOWN_PLUGINS：限制已展示插件数量，防止配置无限增长。"""),
    (47, 'after', """PluginHintRecommendation：渲染提示所需的插件元信息。"""),
    (66, 'after', """功能开关闸门，未启用则直接返回。"""),
    (89, 'after', """maybeRecordPluginHint：同步预存闸门，过滤已展示、已安装、非官方等情形。"""),
    (91, 'after', """triedThisSession：本会话已尝试的插件集合，避免重复解析。"""),
    (96, 'after', """_resetHintRecommendationForTesting：测试重置。"""),
    (135, 'after', """resolvePluginHint：异步查市场缓存并拼出可渲染推荐，不在缓存则返回 null。"""),
    (153, 'after', """markHintPluginShown：记录已展示，实现 show-once 语义。"""),
    (164, 'after', """disableHintRecommendations：用户选择不再展示提示时置 disabled。"""),
]
