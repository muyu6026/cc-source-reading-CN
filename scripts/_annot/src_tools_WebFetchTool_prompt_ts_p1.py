# -*- coding: utf-8 -*-
"""WebFetchTool/prompt.ts 第 1 部分"""

ANNOTATIONS = [
    (2, 'after', '''工具注册名 WebFetch。'''),
    (21, 'after', '''DESCRIPTION（发给模型的说明）：抓 URL → HTML 转 markdown → 小模型按
prompt 处理。注意事项里最重的三条：有 MCP 抓取工具优先用那个（限制更少）；
http 自动升 https；跨域重定向会给特殊格式让模型重发请求。
GitHub URL 建议直接走 gh CLI（结构化数据 + 已认证）。'''),
    (28, 'before', '''makeSecondaryModelPrompt：拼给 Haiku 的完整 prompt = 网页正文 + 用户问题 + 版权准则。'''),
    (34, 'after', '''guidelines 按域分两档：预批准域（官方文档站）鼓励带代码示例与文档摘录；
非预批准域执行版权约束——引文 ≤125 字符、引号外不得逐字复述、不评价合法性、
绝不产出歌词。'''),
    (45, 'after', '''模板结构：正文夹在 --- 之间，紧跟用户 prompt 与准则。'''),
]
