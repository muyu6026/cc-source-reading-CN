# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (8, 'before', 'Props：serverName 加 onDone。项目 .mcp.json 里发现新服务器时的首次确认弹窗——把信任决定落进本地设置，之后不再询问。'),
    (12, 'before', 'MCPServerApprovalDialog：三选项（全部允许、仅此服务器、不使用），Dialog 用 warning 色。'),
    (19, 'before', 'onChange 依赖 serverName 与 onDone 两值记忆化。函数体先打点记录用户选择，再按选择写设置。'),
    (24, 'before', 'bb2 标签块：编译器把 switch 的 break 重写为 break bb2（跳出带标签块），与前批 ApproveApiKey 同源，是读反编译产物的固定套路。'),
    (28, 'before', 'yes 与 yes_all 共享分支：先把服务器名追加进 enabledMcpjsonServers（includes 判重防重复写入）。读设置用 DEPRECATED 接口——此处只需要同步快照，不需要订阅变更。'),
    (35, 'before', 'yes_all 额外写 enableAllProjectMcpServers：此后本项目所有新 MCP 服务器自动启用，不再逐个询问——这是信任级别的跃迁，所以单独一个选项。'),
    (45, 'before', 'no 分支对称：服务器名进 disabledMcpjsonServers。拒绝也落盘——下次遇到同一服务器不再重复弹窗，静默跳过。'),
    (63, 'before', '标题动态拼接 serverName：t2 不进缓存槽（每次渲染重建字符串），因为依赖的 serverName 本身已参与 onChange 的缓存判断。'),
    (74, 'before', 'MCPServerDialogCopy 静态文案进常量槽：MCP 服务器的风险说明（第三方工具可执行任意代码之类），单独成组件便于复用到其他 MCP 弹窗。'),
    (81, 'before', '三选项数组进常量槽。yes_all 排第一、no 排最后：弹窗的默认焦点在第一项，产品倾向是引导启用但把「全部允许」放在「仅此服务器」前面需要用户看清再选；onCancel 兜底映射为 no。'),
]
