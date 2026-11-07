ANNOTATIONS = [
    (1, 'after', """`import * as React` 取全部命名，供 JSX 语法与 `React.ReactNode` 类型使用。"""),
    (2, 'after', """渲染主体是 `PermissionRuleList` 组件，命令本身只负责把它挂上屏。"""),
    (3, 'after', """`LocalJSXCommandCall` 是本地 JSX 命令的调用签名类型，规定 `call` 形参。"""),
    (4, 'after', """引入 `createPermissionRetryMessage`，用于在拒绝重试时生成提示消息。"""),
    (5, 'after', """`call` 是本地 JSX 命令的入口，接收 `onDone` 与 `context` 两个参数。"""),
    (6, 'after', """渲染权限规则列表：退出交给 `onDone`，拒绝重试走 `onRetryDenials`。"""),
    (7, 'after', """重试时把生成的提示消息追加进会话消息列表（保留历史消息）。"""),
    (9, 'after', """函数收尾，返回 JSX 节点即命令的可交互界面。"""),
]
