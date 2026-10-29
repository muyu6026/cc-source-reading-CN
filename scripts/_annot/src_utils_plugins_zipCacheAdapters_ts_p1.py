# 数据文件：src/utils/plugins/zipCacheAdapters.ts
SOURCE_PATH = 'src/utils/plugins/zipCacheAdapters.ts'
ANNOTATIONS = [
    (29, 'after', """文件入口：插件 zip 缓存的 I/O 适配层，读写元数据并解压或打包插件。"""),
    (31, 'after', """元数据 I/O 段：known_marketplaces 的读写。"""),
    (53, 'after', """readZipCacheKnownMarketplaces：读取并校验 known_marketplaces.json，失败返回空对象。"""),
    (65, 'after', """writeZipCacheKnownMarketplaces：原子写入 known_marketplaces.json。"""),
    (67, 'after', """市场 JSON 段：读写单个市场 JSON。"""),
    (95, 'after', """readMarketplaceJson：从 zip 缓存读市场 JSON，schema 失败返回 null。"""),
    (113, 'after', """saveMarketplaceJsonToZipCache：从安装位置读取并写入 zip 缓存。"""),
    (134, 'after', """readMarketplaceJsonContent：按候选路径读取，目录或 URL 源都支持。"""),
    (164, 'after', """syncMarketplacesToZipCache：把已知市场同步进 zip 缓存并与历史缓存合并。"""),
]
