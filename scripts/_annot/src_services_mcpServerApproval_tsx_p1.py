ANNOTATIONS = [
    (15, 'before',
     "这是 `.tsx` 里唯一的一处「服务层代码」——它不含业务逻辑，只负责**弹一个对话框并等用户按完键**。注释点明了关键约束：复用 `main.tsx` 已经建好的 Ink `root` 实例，而不是自己 `render` 一个新 root——同时存在两个 Ink root 会让终端渲染互相踩（两个实例都在往 stdout 写、都在抢 stdin 的 raw mode）。"),
    (19, 'after',
     "只挑**项目级**（`.mcp.json` 里声明的）且状态为 `pending` 的 server。用户级和 local 级的 server 是用户自己配的，不存在「需要批准」的问题；managed 级是管理员推的，也不该弹窗。`getProjectMcpServerStatus` 的状态机决定了这次启动要不要问。"),
    (23, 'after',
     "用 `new Promise` 把**「用户操作完成」这件事变成可 await 的**。Ink 是声明式渲染、没有模态返回值，所以只能靠对话框在用户确认后调 `onDone`。注意 `const done = (): void => void resolve()` 只包了一层 `void`：`onDone` 的签名是 `() => void`，而 `resolve` 需要一个参数（`undefined`），直接传会让 TS 报类型不匹配，包一层是最短写法。"),
    (25, 'after',
     "一个待批的 server 走 `MCPServerApprovalDialog`（单个确认 + 看详情），多个走 `MCPServerMultiselectDialog`（列表里勾选，一次批完）——**不逐个弹窗**。项目换机器或第一次 clone 仓库时，`.mcp.json` 里可能一次冒出五六个 server，逐个确认是折磨。两个弹窗都包了 `AppStateProvider` 和 `KeybindingSetup`：它们是被 `root.render` 直接挂上去的独立树，不继承上层 provider。"),
]
