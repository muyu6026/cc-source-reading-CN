ANNOTATIONS = [
    (1, 'before', '''文件级批注：`zodToJsonSchema.ts` 用 Zod v4 原生 `toJSONSchema` 把 schema 转成 JSON Schema，并基于引用身份做缓存以扛住高频调用。'''),
    (7, 'before', '''导出类型别名：把 JSON Schema 第七版对象统一成可读的 `Record` 类型。'''),
    (12, 'before', '''按引用缓存：用 `WeakMap` 以 Zod schema 实例本身为键，命中即复用转换结果。'''),
    (17, 'before', '''转换入口：先查缓存，未命中才真正转换并写回缓存。'''),
    (23, 'after', '''收尾：缓存命中时直接返回旧结果，避免每次 API 请求重复序列化。'''),
]
