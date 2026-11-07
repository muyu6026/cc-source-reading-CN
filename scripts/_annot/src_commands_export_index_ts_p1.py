# 批注数据：src/commands/export/index.ts
ANNOTATIONS = [
    (1, 'after', '''`/export` 命令的注册入口，只声明命令元数据并懒加载真正的实现模块 `export.tsx`。'''),
    (9, 'after', '''`} satisfies Command` 在编译期校验这个对象是否符合命令契约；`type` 字段取值 `local-jsx`，表示命令以本地 React 对话框形式渲染。'''),
    (11, 'after', '''默认导出命令对象，命令注册表据此统一加载；模块内变量名仅为可读性，外部只认默认导出。'''),
]
