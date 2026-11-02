# source: src/utils/todo/types.ts
ANNOTATIONS = [
    (1, 'before', '''用 zod v4 定义 Todo 项的 schema：content 是非空字符串，status 取自一个懒加载的枚举（pending / in_progress / completed），activeForm 也是非空字符串。'''),
    (18, 'after', '''导出类型：TodoItem 与 TodoList 都通过 z.infer 从各自的懒加载 schema 推导出来，这样能把 zod 依赖隔离，避免打进所有导入方。'''),
]
