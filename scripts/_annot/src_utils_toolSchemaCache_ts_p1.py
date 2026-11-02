ANNOTATIONS = [
    (1, 'before', '''文件级批注：`toolSchemaCache.ts` 维护一个会话级工具 schema 渲染缓存，避免每次渲染都重算约 11K token 的工具块及其下游。'''),
    (13, 'before', '''类型定义：在 `BetaTool` 基础上扩展 `strict` 与 `eager_input_streaming` 两个可选字段。'''),
    (18, 'after', '''常量定义收尾：模块级单例 `Map`，存「键到缓存 schema」的映射。'''),
    (22, 'after', '''第一个函数收尾：对外暴露该缓存 `Map`（只读引用，调用方自行增删）。'''),
    (26, 'after', '''第二个函数收尾：清空整个缓存，由 auth.ts 在鉴权态变化时调用，且不触发 api.ts 的循环依赖。'''),
]
