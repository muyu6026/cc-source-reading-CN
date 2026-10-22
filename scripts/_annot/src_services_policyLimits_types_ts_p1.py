ANNOTATIONS = [
    (12, 'after',
     "Zod v4 + lazySchema（与 teamMemorySync 同一模式：schema 定义惰性加载，避免启动期求值开销）。数据契约的核心是**只记录被禁的策略**——restrictions 是个 record，键出现即「该策略受管」，值里的 allowed 定生死；键缺失就是允许。fail-open 从数据结构就开始，不是运行时判断。"),
    (16, 'after',
     "z.infer 从 schema 派生 PolicyLimitsResponse 类型——契约永远以 schema 为准，不存在手写类型漂移的空间。"),
    (27, 'after',
     "PolicyLimitsFetchResult：拉取结果信封。restrictions 三态——具体对象（200 有内容）/ null（304 缓存有效，魔法值）/ undefined 或缺省（失败）；skipRetry 标 auth 类不重试。与 remoteManagedSettings 的 FetchResult 是同一设计语言的平行版本，读一个就懂另一个。"),
]
