# -*- coding: utf-8 -*-
"""src/utils/model/check1mAccess.ts 的中文批注数据。"""

ANNOTATIONS = [
    (1, 'before', '''一百万上下文窗口的访问资格判定：区分订阅用户（看额外用量是否启用）与非订阅用户（API/按量直接放行），并对 Opus 与 Sonnet 各提供一个入口。'''),
    (11, 'before', '''`isExtraUsageEnabled` 依据缓存的禁用原因判断额外用量是否可用：未缓存时保守判否，空原因判可用，其余按原因分流——仅「已配给但额度耗尽」仍算可用。'''),
    (43, 'after', '''函数末尾统一返回：除「已配给但额度耗尽」外，其余禁用原因一律判否，保证未列出的新原因也落到保守分支。'''),
    (46, 'before', '''`checkOpus1mAccess` 先查全局禁用开关，再按订阅与否分流；非订阅用户（API/按量）无条件有权。'''),
    (60, 'before', '''`checkSonnet1mAccess` 逻辑与 Opus 入口完全一致，只是面向 Sonnet 模型；两者共用同一套资格规则。'''),
]
