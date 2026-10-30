ANNOTATIONS = [
    (17, 'after', '''PrStatus 类型：reviewState 联合类型加 number 与 url 的结构。'''),
    (19, 'after', '''超时常数：gh 命令 5 秒上限。'''),
    (39, 'after', '''deriveReviewState 收尾：草稿恒为 draft，其余按 reviewDecision 映射，缺省 pending。'''),
    (56, 'after', '''默认分支短路：在默认分支上 gh pr view 会返回最近合并的 PR 造成误导，直接返回 null。'''),
    (106, 'after', '''fetchPrStatus 收尾：汇总各路 null 短路（非 git、默认分支、已合并或关闭），成功则填 reviewState。'''),
]
