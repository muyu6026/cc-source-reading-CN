ANNOTATIONS = [
    (1, 'after', """一次性迁移：把旧的 `replBridgeEnabled` 配置键改名为对外的 `remoteControlAtStartup`。"""),
    (10, 'after', """迁移函数幂等：仅当旧键存在、新键未设置时才搬运值，搬完即删旧键。"""),
    (15, 'after', """旧键已不在类型里，用无类型断言读取；旧键缺失则原样返回不迁移。"""),
    (18, 'after', """构造新配置：拷贝其余字段，写入新键（布尔化旧值）并删除旧键。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
