ANNOTATIONS = [
    (16, 'after', '''模块说明：负责从 Anthropic API 拉取并缓存模型能力（如上下文窗口），仅内部蚂蚁用户启用。'''),
    (27, 'after', '''ModelCapabilitySchema：用 strip 去掉仅供内部使用的字段再落盘。'''),
    (34, 'after', '''CacheFileSchema：缓存文件结构为模型列表加时间戳。'''),
    (36, 'after', '''ModelCapability 类型：由 schema 推导出的能力记录形状。'''),
    (51, 'after', '''isModelCapabilitiesEligible 收尾：三重门槛——内部用户、firstParty、首方基地址。'''),
    (58, 'after', '''sortForMatching 收尾：标识长的优先，便于子串匹配取最具体项。'''),
    (73, 'after', '''loadCache 收尾：按缓存路径记忆化同步读取，测试改目录即得新读。'''),
    (83, 'after', '''getModelCapability 收尾：先精确匹配再子串匹配，非 eligible 直接返回 undefined。'''),
    (118, 'after', '''refreshModelCapabilities 收尾：拉取最新能力，与缓存相等则跳写，否则写盘并清记忆化。'''),
]
