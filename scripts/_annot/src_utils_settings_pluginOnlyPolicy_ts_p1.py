ANNOTATIONS = [
    (1, 'before', """本文件实现「定制面是否锁定为仅插件来源」的策略判断，依据受管设置 `strictPluginOnlyCustomization` 决定用户级与项目级来源是否被跳过。"""),
    (4, 'after', """`CustomizationSurface` 是定制面类型，取自 `CUSTOMIZATION_SURFACES` 联合类型的成员。"""),
    (19, 'before', """`isRestrictedToPluginOnly` 判断某定制面是否被锁定为仅插件来源：`true` 锁定全部四个面，数组只锁定列出的面，缺省不锁定。"""),
    (40, 'before', """`ADMIN_TRUSTED_SOURCES` 是管理员可信来源集合：插件、受管设置、内置/打包来源即使面被锁定也照常加载。"""),
    (58, 'before', """`isSourceAdminTrusted` 判断某来源是否属于管理员可信来源，用于在按项检查时放宽锁定（如 frontmatter 钩子注册）。"""),
]
