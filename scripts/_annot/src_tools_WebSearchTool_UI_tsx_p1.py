# -*- coding: utf-8 -*-
"""WebSearchTool/UI.tsx 第 1 部分"""

ANNOTATIONS = [
    (24, 'after', '''getSearchSummary：从混合数组里数出「搜索了几轮、共几条命中」
（字符串项是模型评论，不计入）。totalResultCount 目前只算不用——UI 只报轮数。'''),
    (54, 'after', '''调用行：query 加引号展示；verbose 时追加 only allowing / blocking domains。'''),
    (78, 'after', '''进行中状态按最后一条进度分流：query_update 显示「Searching: <词>」，
search_results_received 显示「Found N results for <词>」——
这就是 call() 里那套 input_json_delta 猜词机制的下游收益。'''),
    (92, 'after', '''结果行只有一句「Did N searches in Xs」：≥1 秒显示秒，否则毫秒。
命中的链接不在此渲染——模型会在回复正文里以 markdown 超链接引用。'''),
    (99, 'after', '''摘要：截断后的 query。'''),
]
