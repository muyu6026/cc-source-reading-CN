# -*- coding: utf-8 -*-
"""src/services/mcp/elicitationHandler.ts 批注数据"""

ANNOTATIONS = [
    (49, 'after', '''// mode 只分 form / url 两种，且**未知一律回落到 form**。
//
// 协议将来加第三种 mode 时，这里会把它当表单处理而不是崩。对未知输入给一个
// 保守默认，是这类「协议兼容层」的常规做法 —— 但要意识到：默认值选错方向
// （比如默认成 url）会让不认识的请求被当成「去打开个链接」。'''),
    (76, 'after', '''// 这个 try/catch 包住的是**注册**，不是处理。原因写在注释里，值得展开：
//
// client 创建时如果没声明 elicitation capability，SDK 的 setRequestHandler
// 会直接抛。于是「这个 client 不支持 elicitation」在代码里表现为
// 「注册失败被吞掉」—— 调用方完全看不出区别，server 那边只会收到 method not found。
//
// 读这种 catch 时永远要问一句：吞掉之后，谁知道发生了什么？这里答案是「没人知道」。'''),
    (91, 'after', '''// hooks 排在 UI **之前**：hook 能直接给出答案，于是这次审批根本不会出现在界面上。
//
// 这也是 CI / 脚本场景唯一能通过 elicitation 的办法 —— 否则会挂在对话框上
// 等一个不存在的人，整条流程僵在那里。所以这个顺序不是性能优化，是可用性前提。'''),
    (117, 'after', '''// abort 时 resolve 成 cancel，而不是 reject。
//
// 理由在协议层：MCP 那边等的是一份 ElicitResult，reject 会让整个请求变成
// 协议错误（连「用户取消了」这个信息都传不出去）。而「用户中断了」在协议里
// 最接近的语义就是 action: 'cancel'。
//
// 顺带一个通用模式：把「异常」翻译成「协议里表达得出来的那一种正常状态」，
// 几乎总比让异常穿透整条链路要好。'''),
    (119, 'after', '''// 先查 aborted 再挂监听，这不是防御性冗余，是必须的：
//
// AbortSignal 的 addEventListener 在 signal **已经** aborted 时不会再触发
// （除非用 { once: true } 之外的选项，也不会补发）。漏了这个前置判断，
// Promise 就永远不会 resolve —— 而它上面的 await 会把整个请求挂住。
//
// 这类「事件已经发生过」的竞态，是 AbortSignal 用得最常踩的一处。'''),
    (138, 'after', '''// respond 里先摘掉 abort 监听、再 resolve。顺序看着无关紧要，其实有两个理由：
//   · 不摘的话，监听器会一直挂在 signal 上，直到 signal 自己被杀 —— 长会话里
//     这就是一条泄露的引用链（signal 属于连接，连接属于会话）
//   · resolve 只认第一次，但 abort 之后仍会走 onAbort 里的逻辑；虽然结果一样，
//     埋点/日志会记成「取消」，诊断时误导人'''),
    (159, 'after', '''// 用户已经在对话框里点完之后，还要过一遍 Result hooks —— 也就是 hooks
// **可以改掉用户的答案**，甚至改成 decline。
//
// 这不是 bug 而是策略层的位置决定的：hooks 是企业/用户下发的规则，
// 它能否决人的选择（「这个字段是敏感信息，不许提交」）。
// 所以 elicitation 的最终答复是「人 + 策略」的合成结果，不是人的原话。'''),
    (174, 'after', '''// 完成通知只把队列里那一项打上 completed 标志，**不 resolve**。
//
// 因为 URL 模式是两段流程：打开浏览器 → 用户在网页上完成 → server 告诉你完成了。
// 但这次 elicitation 的**答复**仍然要用户在对话框里点。两个信号被刻意分开：
// 一个来自 server（完成了吗），一个来自人（批不批准）。'''),
]
