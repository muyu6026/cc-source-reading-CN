# -*- coding: utf-8 -*-
"""WebSearchTool/prompt.ts 第 1 部分"""

ANNOTATIONS = [
    (6, 'after', '''提示词是函数而非常量：每次调用取当前「月份 年份」注入——
让模型搜索时带上正确年份，别拿去年的文档当最新。'''),
    (33, 'after', '''两段硬要求：① 回答末尾必须附 Sources 段（[标题](URL) 格式，MANDATORY）；
② 用当前年月搜最近信息——示例里明说「latest React docs 要带当前年」。
另有域过滤支持与「仅美国可用」的地域限制说明。'''),
]
