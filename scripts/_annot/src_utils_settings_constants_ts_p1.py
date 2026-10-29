ANNOTATIONS = [
    (22, 'after', '''SETTING_SOURCES 列出配置来源，数组顺序即覆盖优先级：靠后的来源覆盖靠前的。'''),
    (24, 'after', '''SettingSource 是由 SETTING_SOURCES 推导出的联合类型，保证二者始终同步。'''),
    (39, 'after', '''getSettingSourceName 返回配置来源的内部短名，用于上下文与技能 UI 的展示。'''),
    (65, 'after', '''getSourceDisplayName 返回配置来源的首字母大写短名，如 User、Project、Managed。'''),
    (93, 'after', '''getSettingSourceDisplayNameLowercase 返回全小写来源名，用于行内说明文案。'''),
    (121, 'after', '''getSettingSourceDisplayNameCapitalized 返回首字母大写来源名，用于 UI 标签。'''),
    (153, 'after', '''parseSettingSourcesFlag 把逗号分隔的命令行标志解析成 SettingSource 数组，非法值直接抛错。'''),
    (167, 'after', '''getEnabledSettingSources 始终包含 policy 与 flag 来源，再并入用户允许的其他来源。'''),
    (177, 'after', '''isSettingSourceEnabled 判断某个来源是否应当被加载。'''),
    (185, 'after', '''EditableSettingSource 排除只读的 policy 与 flag 来源，仅保留用户可编辑的来源。'''),
    (195, 'after', '''SOURCES 是权限规则与 hook 保存 UI 展示的来源顺序，限定为三个可编辑来源。'''),
    (202, 'after', '''CLAUDE_CODE_SETTINGS_SCHEMA_URL 指向 Claude Code 设置的 JSON Schema 地址，供编辑器校验。'''),
]
