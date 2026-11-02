# 批注数据：source/src/utils/withResolvers.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。为 `Promise.withResolvers()` 做垫片，因为 `package.json` 声明支持 Node 18、用不了 ES2024 的原生版本。'''),
    (12, 'after', '''返回 `{ promise, resolve, reject }` 三元组，在 Promise 构造器内部把 resolve/reject 暴露出来，等价于原生 API。'''),
]
