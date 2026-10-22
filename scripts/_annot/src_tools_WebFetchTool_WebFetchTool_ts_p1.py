# -*- coding: utf-8 -*-
"""WebFetchTool/WebFetchTool.ts 第 1 部分"""

ANNOTATIONS = [
    (29, 'after', '''输入两件套：url + prompt——本工具不是「把网页塞给主模型」，
而是「抓网页 → 转markdown → 让小模型按 prompt 提炼 → 只回提炼结果」。'''),
    (46, 'after', '''输出带抓取元数据：字节数、HTTP 状态、耗时、最终 URL。result 是提炼后的文本。'''),
    (64, 'after', '''权限规则的内容键：把输入解析出 hostname，映射成 domain:<host> 规则；
解析失败退回 input:<原始串>（规则匹配永远有键可查）。'''),
    (80, 'after', '''description 按 URL 动态生成——审批弹窗里显示「要从哪个域抓取」。'''),
    (103, 'after', '''自动分类器输入：url + prompt（有 prompt 才拼）。'''),
    (121, 'after', '''权限判定第一关：预批准清单（preapproved.ts）直接放行，
附 decisionReason=Preapproved host。URL 解析失败则落入常规检查。'''),
    (140, 'after', '''deny 规则命中：直接拒绝并说明被拒的域。'''),
    (157, 'after', '''ask 规则命中：弹审批并附一键放行建议（buildSuggestions）。'''),
    (173, 'after', '''allow 规则命中：静默放行。'''),
    (179, 'after', '''无规则兜底：默认 ask + 建议。顺序严格为 预批准→deny→ask→allow→默认 ask，
deny 永远优先于 allow。'''),
    (187, 'after_block', '''prompt() 顶部的认证警告必须无条件携带：曾按 ToolSearch 是否在工具列表里
动态增删这段前缀，结果 SDK query() 调用间描述来回抖动
（ToolSearch 启用与否随 MCP 工具数阈值变化），每次抖动打爆两次 prompt cache——
Anthropic API 的缓存键包含工具描述。这是「缓存键里有什么就别动态改什么」的实例。'''),
    (189, 'after', '''警告正文：认证/私有 URL（Google Docs、Confluence、Jira、GitHub）必挂，
应改用对应的 MCP 工具。'''),
    (203, 'after', '''validateInput：URL 解析失败报错误码 1（zod 的 .url() 已拦一轮，这里是双保险）。'''),
    (216, 'before', '''call 主流程：抓取 → 跨域重定向转述 / 正常内容 → 预批准且是 markdown 且不超长
则跳过 Haiku 直接返回原文 → 否则 applyPromptToMarkdown 提炼。'''),
    (249, 'after', '''跨域重定向不自动跟：把原始/重定向 URL 与状态码拼成结构化消息返回，
并明确指示模型「用新 URL 再调一次 WebFetch」——把是否跟随的决定权留给审批层。'''),
    (269, 'after', '''预批准域 + text/markdown + 不超 10 万字符 → 跳过小模型直接用原文
（预批准的是文档站，内容就是给模型读的，二次提炼反而丢细节）。'''),
    (277, 'after', '''常规路径：applyPromptToMarkdown 让 Haiku 按 prompt 提炼。'''),
    (285, 'after', '''二进制内容已落盘的：在结果尾部补一句「原始文件存在哪」，
Haiku 摘要不够用时模型可以自己去读文件。'''),
    (306, 'after', '''工具结果块就是 result 文本本体。'''),
    (318, 'after', '''buildSuggestions：ask 时附「把 domain:<host> 加进 localSettings 放行」的
一键建议——用户点一下，下次同域不再弹窗。'''),
]
