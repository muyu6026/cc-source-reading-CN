# -*- coding: utf-8 -*-
"""src/services/mcp/types.ts 批注数据"""

ANNOTATIONS = [
    (21, 'after', '''// 七个 scope 回答的是「配置从哪来」，不是「配置长什么样」：
//   local / user / project 是三层文件（项目私有 / 全局 / 仓库共享）
//   dynamic 来自命令行，enterprise 由组织下发，claudeai 从远端拉，managed 是托管设备
//
// 同一个 server 名可以在多处出现，靠优先级合并。所以 scope 一定要跟着配置走 ——
// 后面所有「要不要信任它」的判断，第一件事都是看 scope。'''),
    (26, 'after', '''// 这个枚举和下面的 type 字面量**对不上**：有 sse-ide / sdk，但没有 ws-ide
// 和 claudeai-proxy。
//
// 而且它在整个仓库里没有任何读者（只有这两行自己引用自己）。
// 判定方法很简单：grep 符号名，只命中定义处。这是历史残留，可以跳过。'''),
    (41, 'after', '''// xaa 只是一个布尔：IdP 的连接细节（issuer、clientId、callbackPort）在全局
// settings.xaaIdp 里配一次，所有开了 xaa 的 server 共用。
//
// 这个设计把「企业 SSO 的复杂度」从 N 个 server 收到 1 处 —— 加一台新 server
// 不需要再走一次 IdP 注册。代价是那套全局配置成了新的单点，改它影响所有 server。'''),
    (135, 'after', '''// union 是**按顺序**试的，两个后果：
//   · stdio 的 type 是 optional，所以一个不写 type 的对象会先命中 stdio
//   · 写错 type 值的对象会一路掉到底，报的是 union 错误（列出全部分支，很长）
//
// 所以看配置解析失败的错误信息时，别被那一长串分支吓到：真正的错因通常只是
// 「type 写错了」或「少了一个必填字段」。'''),
    (169, 'after', '''// scope 挂在类型上、而不是塞进配置对象里，是因为它描述的是「出身」不是「内容」。
//
// 这条区分有具体后果：hashMcpConfig（utils.ts）必须把 scope 摘掉再算哈希，
// 否则「把同一个 server 从 .mcp.json 挪到 settings.json」会被判成配置变了、
// 白重连一次 —— 用户看到的是「改了个文件位置，所有工具抖了一下」。
//
// pluginSource 则相反，它是内容的一部分（决定能不能被通道闸放行），所以要参与哈希。'''),
    (231, 'after', '''// 从这里往下三个 interface 在本仓库内是**死代码**：
// SerializedTool / SerializedClient 只被 MCPCliState 用到，而 MCPCliState 没人用。
//
// 形状明显是给「外部消费者读 CLI 的 MCP 状态」准备的（序列化过的，适合过 IPC），
// 但那条链路没接上。读的时候可以直接跳到文件末尾 ——
// 判断方法还是老一套：grep 符号名，只命中自身。
//
// 留着而不是删掉，通常是因为「不确定外部有没有人 import」——
// 这类犹豫在闭源仓库里很常见，在能全局 grep 的仓库里其实是可以确定的。'''),
]
