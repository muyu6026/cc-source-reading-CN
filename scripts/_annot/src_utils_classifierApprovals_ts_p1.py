# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'after', '''分类器自动放行的记账本：谁被 bash 分类器放行、谁被 auto 模式放行、谁正在被检查，供 UI 在工具结果旁标注「为什么没弹确认框」。'''),
    (17, 'after', '''一个信号加两个容器：approvals 存结果（toolUseID 到放行理由），checking 存进行中集合，信号只负责通知 UI 重渲。'''),
    (30, 'after', '''写入前先看 feature 开关：未开启的构建里这个函数是纯 no-op，调用点因此不必各自判开关。'''),
    (39, 'after', '''读取时再校一次 classifier 类型：同一个 toolUseID 可能先被 bash 写入、后被 auto 写入，读的一方要确认拿到的是自己要的那类理由。'''),
    (49, 'after', '''auto 模式放行只存 reason 不存 matchedRule：它没有规则可匹配，判定来自整段对话的分类结果。'''),
    (60, 'after', '''两个读取函数的结构完全对称：各自校自己的 classifier 类型，互不串味。'''),
    (72, 'after', '''检查状态用 Set 而不是 Map：只关心「在不在检查中」，不需要附带数据；增删后 emit 一次触发 UI 更新。'''),
    (82, 'after', '''删除按单个 toolUseID 做：一条工具结果渲染完就该清掉，避免这张表随会话无限增长。'''),
    (88, 'after', '''清空要同时清两个容器并 emit：只清 approvals 会让 UI 里残留「检查中」的转圈状态。'''),
]
