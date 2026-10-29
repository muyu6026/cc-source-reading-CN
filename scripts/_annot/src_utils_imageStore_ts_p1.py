# 数据文件：src/utils/imageStore.ts
SOURCE_PATH = 'src/utils/imageStore.ts'
ANNOTATIONS = [
    (7, 'after', """文件入口：把粘贴的图片内容持久化到磁盘缓存，并提供内存路径索引。"""),
    (10, 'after', """缓存上限常量：最多保留 200 条图片路径，超出时淘汰最旧条目。"""),
    (20, 'after', """getImageStoreDir：按会话 ID 隔离的图片缓存目录。"""),
    (36, 'after', """getImagePath：按媒体类型推断扩展名，拼出图片文件路径。"""),
    (49, 'after', """cacheImagePath：仅写入内存索引（不落盘），返回路径或 null。"""),
    (79, 'after', """storeImage：落盘并 datasync，失败仅记日志并返回 null。"""),
    (99, 'after', """storeImages：批量存储，返回 ID 到路径的映射。"""),
    (106, 'after', """getStoredImagePath：从内存索引取回已存图片路径。"""),
    (113, 'after', """clearStoredImagePaths：清空内存索引。"""),
    (124, 'after', """evictOldestIfAtCap：超出上限时删除 Map 中最旧的条目。"""),
    (167, 'after', """cleanupOldImageCaches：清理过往会话的图片缓存目录。"""),
]
