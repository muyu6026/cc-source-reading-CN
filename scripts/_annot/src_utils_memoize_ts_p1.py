# 批注数据：source/src/utils/memoize.ts（第 66 批）
# 锚点：行号, 位置(before/after/after_block), 中文批注（自带「注：」前缀，禁止 " 与 \）
ANNOTATIONS = [
    (1, 'before', """注：本文件提供三种带生存时间或容量上限的「记忆化（缓存）」包装，避免对同一输入重复计算，并提供清缓存等方法。"""),
    (5, 'before', """注：CacheEntry 是同步版的缓存单元：值、写入时间戳、是否正在后台刷新三个字段。"""),
    (11, 'before', """注：MemoizedFunction 与 LRUMemoizedFunction 给记忆化后的函数附加 cache 对象，LRU 版还暴露 size/delete/get/has。"""),
    (40, 'before', """注：memoizeWithTTL 实现「写穿透」缓存：新鲜就直接返回，过期就返回旧值并后台刷新，未命中则阻塞计算。默认五分钟寿命。"""),
    (120, 'before', """注：memoizeWithTTLAsync 是异步版，额外用 inFlight 表对并发冷未命中去重，避免同一时刻 spawn 多次外部调用（如多次 aws sso 登录）。"""),
    (234, 'before', """注：memoizeWithLRU 用 LRUCache 限制最大条目数，防止无界增长；取键与计算由调用方传入，命中直接返回值。"""),
    (242, 'after', """注：LRU 缓存以 max 为容量上限实例化，超出时自动淘汰最久未用的条目。"""),
    (260, 'before', """注：这里把 clear/size/delete/get/has 暴露到 cache 上；get 用 peek 只观察不提升热度，避免误改淘汰顺序。"""),
]
