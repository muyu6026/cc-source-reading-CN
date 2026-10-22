# -*- coding: utf-8 -*-
"""WebFetchTool/UI.tsx 第 1 部分"""

ANNOTATIONS = [
    (28, 'after', '''工具调用行：verbose 显示 url + prompt，紧凑模式只显示 url。'''),
    (33, 'after', '''进行中状态：一行「Fetching…」。'''),
    (62, 'after', '''结果行：Received <大小> (<状态码> <状态文本>)；verbose 追加提炼结果全文，
紧凑只留这一行——正文细节都在 Haiku 的 result 里，反正也不长。'''),
    (70, 'after', '''getToolUseSummary：截断到摘要上限的 URL，供活动流用。'''),
]
