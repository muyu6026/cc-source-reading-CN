# 批注数据：src/utils/plugins/pluginIdentifier.ts
# slug: src_utils_plugins_pluginIdentifier_ts
ANNOTATIONS = [
    (8, 'after', '''插件标识符与来源映射：负责解析「name@marketplace」形式的插件标识，并在插件作用域（scope）与可编辑设置来源（SettingSource）之间双向映射。'''),
    (14, 'after', '''ExtendedPluginScope：在基础作用域之上增加「flag」，表示仅当前会话生效、不持久化到 installed_plugins.json 的插件。'''),
    (20, 'after', '''PersistablePluginScope：从扩展作用域中排除 flag，得到可持久化的作用域集合。'''),
    (33, 'after', '''SETTING_SOURCE_TO_SCOPE：把各类设置来源映射到插件作用域，用 satisfies 保证类型完备且单一来源。'''),
    (41, 'after', '''ParsedPluginIdentifier：解析后的插件标识结构，包含 name 与可选的 marketplace。'''),
    (57, 'after', '''parsePluginIdentifier：按第一个「@」拆分插件标识为名称与来源；多个「@」时后续部分忽略（来源名不应含「@」）。'''),
    (67, 'after', '''buildPluginId：把名称与来源拼回「name@marketplace」格式的插件 ID。'''),
    (82, 'after', '''isOfficialMarketplaceName：判断来源名是否为官方（Anthropic 控制）市场，用于遥测脱敏——官方标识可进通用字段，第三方进 PII 标记列。'''),
    (96, 'after', '''SCOPE_TO_EDITABLE_SOURCE：可编辑作用域到可写设置来源的反向映射，不含 managed（托管作用域不可安装）。'''),
    (111, 'after', '''scopeToSettingSource：把插件作用域转换成对应的可编辑设置来源；遇到 managed 抛错，因为托管作用域不能安装插件。'''),
    (123, 'after', '''settingSourceToScope：把可编辑设置来源转换回插件作用域，与 SETTING_SOURCE_TO_SCOPE 保持一致。'''),
]
