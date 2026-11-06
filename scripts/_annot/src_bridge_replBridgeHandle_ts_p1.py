# 数据文件：source/src/bridge/replBridgeHandle.ts
ANNOTATIONS = [
    (1, 'after', """全局持有当前 REPL 桥接 handle 的指针：让 React 树外的调用方（tools、斜杠命令）也能调用 subscribePR 等方法；与 bridgeDebug 同样的「每进程一个桥」理由。"""),
    (16, 'after', """模块级 handle 变量，初始为空；由 useReplBridge 初始化、拆卸时清空。"""),
    (18, 'after', """设置 handle 时同步在会话记录里发布（或清除）本机桥接 session id，便于其他本地节点去重（优先本地）。"""),
    (25, 'after', """读取当前 handle。"""),
    (33, 'after', """把当前 handle 的桥接 session id 转成 API /v1/sessions 返回格式的兼容 id；未连接则返回 undefined。"""),
]
