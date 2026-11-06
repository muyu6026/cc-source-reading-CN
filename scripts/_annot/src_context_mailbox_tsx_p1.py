# 数据文件：source/src/context/mailbox.tsx
ANNOTATIONS = [
    (1, 'after', """Mailbox 的 React 上下文：提供 MailboxProvider 注入一个共享 Mailbox 实例，useMailbox 取出；这是 React 编译器产物（_c 缓存槽 + $[k] 依赖比较）。"""),
    (4, 'after', """创建上下文，默认 undefined（要求必须在 Provider 内使用）。"""),
    (8, 'after', """Provider：用 _c(3) 缓存槽，首次渲染 new 一个 Mailbox 并永久缓存，children 变化时只重算 Provider 元素。"""),
    (31, 'after', """useMailbox：取上下文，若不在 Provider 内则抛错。"""),
]
