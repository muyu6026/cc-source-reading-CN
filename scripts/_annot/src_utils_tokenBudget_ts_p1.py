# -*- coding: utf-8 -*-
"""src/utils/tokenBudget.ts 的中文批注数据。"""

ANNOTATIONS = [
    (1, 'before', '''从自然语言文本里解析 token 预算：支持「开头或结尾的简写（+500k）」与「正文里的完整说法（use 2M tokens）」两类写法，并给出匹配区间供高亮。'''),
    (15, 'after', '''`MULTIPLIERS` 把 k/m/b 后缀映射为千、百万、十亿的系数；任何解析结果都乘以它还原成真实 token 数。'''),
    (17, 'before', '''`parseBudgetMatch` 把匹配到的数值与后缀相乘，得到以 token 为单位的预算值。'''),
    (21, 'before', '''`parseTokenBudget` 按优先级依次尝试三种正则：开头简写、结尾简写、完整说法，命中其一即返回数值，否则返回空。'''),
    (31, 'before', '''`findTokenBudgetPositions` 返回所有预算表达的起止区间，用于界面高亮；结尾简写若已被开头简写覆盖则跳过，避免重复计数。'''),
    (66, 'before', '''`getBudgetContinuationMessage` 生成「已达到预算百分比、继续工作不要总结」的续写提示，数字用千分位格式化。'''),
]
