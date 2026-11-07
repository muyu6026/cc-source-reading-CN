# 批注数据：source/src/commands/help/help.tsx
ANNOTATIONS = [
    (1, 'before', '''本文件实现 `help` 命令的本地 JSX 渲染：打开新版帮助面板。
`call` 是渲染入口，末尾的 source map 被省略不抄。'''),
    (3, 'after', '''从命令类型定义引入 `LocalJSXCommandCall`，约束 `call` 的签名形状。'''),
    (9, 'after', '''渲染 `HelpV2` 组件，把可用命令列表与关闭回调 `onDone` 作为属性传入。'''),
    (10, 'after', '''`};` 收尾整个箭头函数，导出 `call` 供命令系统调用。'''),
]
