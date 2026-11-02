# 批注数据：source/src/utils/crypto.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。这是给打包器 `browser` 字段用的替换入口：浏览器构建会换成 `crypto.browser.ts`，从而省掉约 500KB 的 polyfill。'''),
    (13, 'after', '''关键陷阱：不能直接 `export { randomUUID } from 'crypto'`，那种重导出语法在 bun 的字节码编译下会丢失绑定；这里改成先 import 再 export，才能生成正确的活动绑定。'''),
]
