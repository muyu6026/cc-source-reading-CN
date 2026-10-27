ANNOTATIONS = [
    (29, 'after', '''把 ToolUseContext 桥接到 @ant/computer-use-mcp 的会话上下文：每进程绑定一次 dispatcher，并按调用更新 per-call 引用（中止控制器/渲染回调/系统通知）。'''),
    (55, 'after', '''tuc：从模块级 currentToolUseContext 取出当前调用上下文，仅在分发起效期间被 ctx 回调调用。'''),
    (228, 'after', '''buildSessionContext：构建读写 AppState 的会话上下文，涵盖允许应用、授权标志、显示选择、截图尺寸与锁的读写回写。'''),
    (238, 'after', '''getOrBind：首次调用时构建会话上下文并绑定 dispatcher，之后复用整进程生命周期。'''),
    (287, 'after', '''getComputerUseMCPToolOverrides：返回渲染覆盖对象与 .call 方法，把 MCP 内容块映射为 Anthropic API 图像/文本块。'''),
    (335, 'after', '''runPermissionDialog：用 setToolJSX 渲染授权弹窗并以 Promise 等待用户决定，中止信号已触发时立即 reject 避免挂起。'''),
]
