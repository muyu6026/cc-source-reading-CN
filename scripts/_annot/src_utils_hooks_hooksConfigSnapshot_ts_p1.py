# 数据文件：src/utils/hooks/hooksConfigSnapshot.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/hooks/hooksConfigSnapshot.ts'

ANNOTATIONS = [
    (6, 'after', '导入策略态读取、插件仅限策略、设置模块（用命名空间导入以便测试 spy）与设置缓存重置。'),
    (53, 'after', 'getHooksFromAllowedSources：按策略决定哪些来源的钩子生效——托管禁用全部则空、仅托管则只用托管、插件仅限则退托管、否则合并全部（向后兼容）。'),
    (76, 'after', 'shouldAllowManagedHooksOnly：当策略开启仅托管，或非托管设了禁用全部（非托管不能关托管）时，返回 true。'),
    (88, 'after', 'shouldDisableAllHooksIncludingManaged：仅当托管/策略设置明确禁用全部时才 true；非托管禁用时托管钩子仍运行。'),
    (97, 'after', 'captureHooksConfigSnapshot：在启动期抓取一次当前钩子配置快照。'),
    (112, 'after', 'updateHooksConfigSnapshot：先重置设置缓存再重新抓取，避免外部改 settings.json 后读到过期缓存。'),
    (124, 'after', 'getHooksConfigFromSnapshot：从快照取配置，无快照时自动补抓一次。'),
    (133, 'after', 'resetHooksConfigSnapshot：清空快照并重置 SDK 初始化态，主要用于测试隔离。'),
]
