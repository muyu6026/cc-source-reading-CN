ANNOTATIONS = [
    (7, 'after', '''SYSTEM_REMINDER_CLOSE 缓存系统提醒的闭合标签，用于后续从搜索文本中剥离上下文噪音。'''),
    (11, 'after_block', '''这段注释说明：渲染层会把中断类消息替换成哨兵标记，原始文本永不出现在屏幕上，因此直接搜索会产生幽灵匹配。'''),
    (15, 'after', '''RENDERED_AS_SENTINEL 收集需要被替换成空串的中断消息常量，避免它们污染搜索结果。'''),
    (17, 'after', '''searchTextCache 用 WeakMap 缓存每条消息的可搜索文本，消息不可变且只增不删，缓存命中永远有效。'''),
    (24, 'before', '''renderableSearchText 把一条消息压平成小写可搜索文本，并在缓存层统一转小写以省去每次按键重复转换。'''),
    (30, 'after', '''renderableSearchText 收尾：命中缓存直接返回，否则计算后写入缓存再返回。'''),
    (128, 'after', '''computeSearchText 收尾：剥离所有 `<system-reminder>` 片段，因为这些是 Claude 上下文而非用户可见内容。'''),
    (134, 'before', '''toolUseSearchText 用鸭子类型抽取工具调用的可见参数（command、pattern、file_path 等），未知字段留空，宁少勿假。'''),
    (164, 'after', '''toolUseSearchText 收尾：拼接已知字段与数组型参数，返回可搜索文本。'''),
    (171, 'before', '''toolResultSearchText 抽取工具原生输出的可搜索文本，优先匹配已知形状（stdout/stderr、content、filenames 等）。'''),
    (202, 'after', '''toolResultSearchText 收尾：未知形状回退为拼接顶层字符串字段，未知则留空，避免索引模型内部噪音。'''),
]
