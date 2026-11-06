ANNOTATIONS = [
    (15, 'after', """门控变量初始未注册；SDK 路径永不注册，故 shim 默认视为启用。"""),
    (23, 'after', """由已引入 bridgeEnabled 的桥接初始化代码注入门控函数。"""),
    (42, 'after', """cse_ 转 session_：同一 UUID 换前缀，适配兼容层端点。"""),
    (57, 'after', """反向转换 session_ 转 cse_，供基础设施层调用使用。"""),
]
