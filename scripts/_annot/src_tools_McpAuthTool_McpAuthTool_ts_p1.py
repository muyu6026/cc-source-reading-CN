# -*- coding: utf-8 -*-
"""McpAuthTool/McpAuthTool.ts 第 1 部分"""

ANNOTATIONS = [
    (23, 'after', '''输入 schema 为空对象：这个伪工具不接受任何参数——认证动作本身没有可配置项，
服务器身份由工厂闭包携带。'''),
    (30, 'after', '''输出三态：auth_url（拿到授权 URL）/ unsupported（传输类型不支持 OAuth）/ error（启动失败）。
authUrl 仅在 auth_url 且非静默认证时存在。'''),
    (35, 'after', '''getConfigUrl：只有 url 型配置（sse/http）才有可展示的 URL；
stdio 型没有，展示层就退化为只显示传输类型。'''),
    (49, 'before', '''createMcpAuthTool：为「已安装但未认证」的 MCP 服务器生成一个伪工具，
顶替该服务器真正的工具位。模型由此得知服务器存在，并可代用户发起 OAuth。
认证完成后 OAuth 回调在后台走完，reconnectMcpServerImpl 重连，
真实工具经 appState.mcp.tools 的前缀替换（useManageMCPConnections.updateServer
会清掉所有 mcp__<server>__*）换入，伪工具随之自动消失。'''),
    (55, 'after', '''transport 默认 stdio；location 拼出「类型 @ URL」的人读描述，stdio 时只有类型。'''),
    (70, 'after', '''工具名走 buildMcpToolName(serverName, 'authenticate')——与真实 MCP 工具同前缀，
这是认证完成后能被前缀替换机制一并清掉的关键。userFacingName 给人看。'''),
    (83, 'after', '''checkPermissions 恒 allow：发起认证不需要额外审批——
真正的用户动作发生在浏览器里完成 OAuth，这里没有可越权的东西。'''),
    (96, 'after', '''claude.ai 代理连接器走独立认证流（MCPRemoteServerMenu 的 handleClaudeAIAuth），
无法在此编程触发——只能指引用户跑 /mcp 手动认证。'''),
    (108, 'after', '''performMCPOAuthFlow 只接受 sse/http。needs-auth 状态只在 HTTP 401
（UnauthorizedError）时设置，其他传输类型按理到不了这里，但防御性兜底。'''),
    (121, 'after', '''authUrlPromise：手工构造的 Promise + resolve 句柄。
performMCPOAuthFlow 通过 onAuthorizationUrl 回调把授权 URL 递进来，
工具随即返回；整个 OAuth 流的 Promise 要等浏览器回调之后才 resolve。'''),
    (132, 'after', '''skipBrowserOpen: true——工具不发浏览器，URL 交给模型转述给用户
（模型可能在无头环境，也可能想把链接写进消息）。'''),
    (137, 'after', '''void oauthPromise.then(...)：后台续段——OAuth 完成后清认证缓存、重连服务器、
把真实工具/命令/资源经前缀替换写回 appState。catch 只记日志不抛出：
工具此刻早已返回，失败只能体现在下次工具列表刷新上。'''),
    (172, 'after', '''后台失败的兜底：logMCPError 记录，不中断主流程。'''),
    (180, 'after', '''Promise.race 竞速：拿到 URL 就返回 URL；
若整个 OAuth 流先跑完（如 XAA 带 IdP 缓存令牌的静默认证）则返回 null——静默完成。'''),
    (190, 'after', '''非静默路径：把授权 URL 原样交给模型，消息里明确「用户在浏览器完成后工具自动可用」。'''),
    (197, 'after', '''静默路径：认证已悄然完成，告知模型服务器工具应该已经就绪。'''),
    (204, 'after', '''启动失败：错误信息原样回传并降级指引（跑 /mcp 手动认证）。'''),
    (213, 'after', '''工具结果块只带 message 一段文本——模型读到的就是这个字符串。'''),
]
