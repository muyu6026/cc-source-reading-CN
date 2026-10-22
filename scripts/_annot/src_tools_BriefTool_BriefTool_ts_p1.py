# -*- coding: utf-8 -*-
"""BriefTool/BriefTool.ts 第 1 部分"""

ANNOTATIONS = [
    (37, 'after', '''输入 schema：message（markdown 正文）、attachments（可选文件路径）、
status 标注意图——proactive 是「用户没问但你必须让他看到」（后台任务完成/遇到阻塞），
normal 是对用户刚说的话的回复。下游路由按这个字段分流。'''),
    (41, 'after_block', '''attachments 必须保持可选：恢复（resume）的会话会原样重放旧输出，
若设为必填字段，恢复到 attachment 功能上线前的记录会直接崩掉 UI 渲染器。'''),
    (63, 'after', '''输出 schema 同理全部可选：sentAt 是工具执行时在本进程记的 ISO 时间戳，
旧记录重放时没有这个字段——可选性是兼容性要求，不是偷懒。'''),
    (67, 'after', '''5 分钟：GB（GrowthBook）特性开关的刷新周期，作为会话中途的 kill-switch 生效间隔。'''),
    (100, 'after', '''isBriefEntitled：用户「有没有资格」用 Brief。构建期特性 OR 门（KAIROS || KAIROS_BRIEF）
+ 运行时 GB 门 + 助手模式直通；不含 opt-in 检查——它决定 opt-in 是否被尊重，
而非用户是否已 opt-in。注意正 ternary 写法（见 docs/feature-gating.md）：
负向提前 return 会让 GB 门字符串残留在对外构建里。'''),
    (134, 'after', '''isBriefEnabled：统一的激活总闸，管四件事——工具可用性、系统提示词 Brief 段、
工具延迟豁免、todo 催促抑制。激活需显式 opt-in（--brief / defaultView:chat /
/brief / /config / SendUserMessage / 环境变量），助手模式（kairosActive）豁免 opt-in。
GB 门在这里二次检查作 kill-switch：会话中途关掉 tengu_kairos_brief，
5 分钟刷新后即使已 opt-in 也会失效。「已注册但默认开启」的历史 bug 就是靠这行修复的。'''),
    (152, 'after', '''isEnabled 走 isBriefEnabled（惰性、init 后才调用，绝不模块顶层——
getKairosActive/getUserMsgOptIn 在 main.tsx 里才赋值）。'''),
    (168, 'after', '''validateInput：有附件才校验（存在性/可读性/是否常规文件），委托 attachments.ts。'''),
    (183, 'after', '''工具结果文本：Message delivered to user (+N attachments included)——
模型据此知道消息已送达及附件数量。'''),
    (191, 'after', '''tengu_brief_send 埋点：是否 proactive、附件数。'''),
    (202, 'after', '''call：记 sentAt → 打点 → 无附件直接返回 → 有附件经 resolveAttachments
解析（桥接开启时含上传换 file_uuid）。'''),
]
