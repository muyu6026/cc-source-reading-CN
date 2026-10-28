ANNOTATIONS = [
    (31, 'before', """shouldAllowManagedPermissionRulesOnly：判断托管设置是否强制只认托管权限规则，开启后隐藏始终允许选项。"""),
    (42, 'before', """shouldShowAlwaysAllowOptions：与上一函数相反，用于决定权限提示里是否展示始终允许。"""),
    (46, 'after', """SUPPORTED_RULE_BEHAVIORS：权限规则仅支持 allow、deny、ask 三种行为，用 satisfies 保证类型与 PermissionBehavior 一致。"""),
    (61, 'before', """getSettingsForSourceLenient_FOR_EDITING_ONLY_NOT_FOR_READING：宽松读取设置，跳过校验以保留既有规则，仅用于编辑追加，绝不用于执行。"""),
    (91, 'before', """settingsJsonToRules：把设置 JSON 的 permissions 部分按行为转换成 PermissionRule 对象数组。"""),
    (120, 'before', """loadAllPermissionRulesFromDisk：从所有相关来源加载权限规则，若开启仅托管则只取 policySettings。"""),
    (140, 'before', """getPermissionRulesForSource：从指定来源读取并转换权限规则。"""),
    (163, 'before', """deletePermissionRuleFromSettings：从可编辑来源（用户、项目、本地）删除一条权限规则。"""),
    (186, 'after', """normalizeEntry：通过解析再序列化把旧名（如 KillShell）归一化到规范名（如 TaskStop）以便精确匹配。"""),
    (229, 'before', """addPermissionRulesToSettings：向可编辑来源追加权限规则，先用正常加载器，校验失败则回退宽松加载以保留既有规则。"""),
    (265, 'after', """用 Set 对已存在规则做归一化去重，避免重复写入相同规则。"""),
]
