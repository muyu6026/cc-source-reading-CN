ANNOTATIONS = [
    (1, 'after', """`/context` 双入口：交互态用彩色网格可视化上下文占用，非交互态只展示纯文本用量。"""),
    (4, 'after', """交互版：仅在交互会话启用，类型 `local-jsx`，按需懒加载 `context.js`。"""),
    (12, 'after', """非交互版：靠 `isHidden`/`isEnabled` 与交互版互斥，只在非交互会话可见可运行。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
