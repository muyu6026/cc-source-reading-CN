# 数据文件：src/utils/permissions/PermissionMode.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/permissions/PermissionMode.ts'

ANNOTATIONS = [
    (12, 'after', '导入权限模式相关的类型与延迟加载 schema 工具（类型抽到 types/permissions.ts 以打破导入环）。'),
    (19, 'after', '为兼容旧代码，把权限模式枚举与类型重新导出。'),
    (24, 'after', '两个 zod 枚举 schema，用 lazySchema 包裹以便按需加载。'),
    (40, 'after', '单一模式的可展示配置：标题、短标题、符号、颜色键、对外模式名。'),
    (91, 'after', '各权限模式的可视化配置表；auto 模式仅 ant 内部构建才有，且被排除在对外模式之外。'),
    (105, 'after', '类型守卫：判断某权限模式是否为对外模式（auto 只给 ant 用，故对外用户永远返回 true）。'),
    (109, 'after', 'getModeConfig：取模式配置，缺失时回退到 default。'),
    (115, 'after', 'toExternalPermissionMode：把内部模式映射成对外的 ExternalPermissionMode。'),
    (121, 'after', 'permissionModeFromString：从字符串解析权限模式，非法值回退 default。'),
    (125, 'after', 'permissionModeTitle：返回模式的完整标题。'),
    (129, 'after', 'isDefaultMode：空或 default 都算默认模式。'),
    (133, 'after', 'permissionModeShortTitle：返回模式的简短标题。'),
    (137, 'after', 'permissionModeSymbol：返回模式在 UI 上显示的符号。'),
    (141, 'after', 'getModeColor：返回模式对应的颜色键。'),
]
