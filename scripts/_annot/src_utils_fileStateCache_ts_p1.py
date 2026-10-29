# 数据文件：src/utils/fileStateCache.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/fileStateCache.ts'

ANNOTATIONS = [
    (2, 'after', '导入 LRU 缓存库与路径规范化函数（path.normalize 可把 /foo/../bar 这类等价路径统一）。'),
    (15, 'after', '文件状态记录类型：保存读取到的内容、时间戳、偏移与长度；isPartialView 标记「模型只看到了被裁剪过的视图，必须先 Read 再 Edit/Write」。'),
    (18, 'after', '读文件状态缓存的默认最大条目数（100 条）。'),
    (22, 'after', '缓存默认字节上限 25MB，防止超大文件内容让内存无限增长。'),
    (30, 'after', 'FileStateCache：对路径键在访问前统一做 normalize 的缓存封装，保证相对/绝对、Windows 正斜杠反斜杠混用都能命中同一项。'),
    (92, 'after', 'load：用序列化后的快照重建缓存（与 dump 配对）。'),
    (106, 'after', '工厂函数：创建一个带字节上限的 FileStateCache（图片不进缓存，上限主要管大文本、笔记本等可编辑内容）。'),
    (113, 'after', 'cacheToObject：把缓存转成普通对象，供 compact.ts 使用。'),
    (118, 'after', 'cacheKeys：取出缓存里所有键，供多个组件复用。'),
    (126, 'after', 'cloneFileStateCache：克隆时保留源缓存的条目数与字节上限配置。'),
    (142, 'after', 'mergeFileStateCaches：合并两份缓存，时间戳更新的条目覆盖旧条目。'),
]
