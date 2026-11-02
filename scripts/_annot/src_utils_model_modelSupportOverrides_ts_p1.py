ANNOTATIONS = [
    (1, 'after', '''文件级：为第三方（3p）模型按环境变量覆盖其能力开关，用 lodash 的 memoize 缓存结果（键是 model:capability 小写串）。'''),
    (11, 'before', '''TIERS 定义三个固定档位（opus/sonnet/haiku），各自对应一个模型名环境变量与一个支持能力列表环境变量。'''),
    (30, 'before', '''memoize 包裹的查询函数：首方（firstParty）直接返回 undefined；否则遍历 TIERS，匹配上的模型把能力列表按逗号拆开、小写化后判断是否包含该 capability。'''),
    (50, 'after', '''收尾：memoize 的第二个参数是缓存键工厂，把 model 与 capability 拼成「model:capability」小写串，保证同类查询命中同一缓存。'''),
]
