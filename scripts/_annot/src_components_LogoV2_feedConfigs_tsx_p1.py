# -*- coding: utf-8 -*-
# annotations for src/components/LogoV2/feedConfigs.tsx (92 lines)
ANNOTATIONS = [
    (11, 'before', '四个 Feed 工厂函数之一（RecentActivity）：把会话日志转成 FeedConfig（标题+行+footer+空态文案）'),
    (14, 'after', '描述优先取 summary，但排除「No prompt」占位文案，回落到 firstPrompt'),
    (23, 'after', 'footer 是行动入口：/resume for more；空列表时 undefined 隐藏'),
    (27, 'before', 'WhatsNew 工厂：release notes 列表转 Feed'),
    (29, 'after', '「external」===「ant」是构建期内联的 feature flag：对外版本恒为 false，内部版本才解析时间戳前缀——死代码保留以便内部构建复用'),
    (42, 'after', 'emptyMessage 与 title 都按同一 flag 分叉：内部版显示 CC 内部 commits，外部版引导看 changelog'),
    (50, 'before', 'ProjectOnboarding 工厂：过滤启用步骤并排序'),
    (53, 'after', 'sort 按 Number(isComplete) 升序：未完成（0）排前、已完成（1）排后——待办项置顶，完成项带勾沉底'),
    (58, 'after', 'checkmark 前缀：完成加勾和空格，未完成是空串'),
    (63, 'after', 'home 目录警告：cwd 等于 homedir 时追加一条提示——在家目录跑 claude 体验不佳'),
    (74, 'before', 'GuestPasses 工厂：无 lines，用 customContent 自定义渲染区'),
    (76, 'after', 'subtitle 按有无推荐奖励分叉：有奖励显示具体金额（formatCreditAmount），没有就是泛泛的分享文案'),
    (87, 'after', 'customContent 带 width: 48：自定义内容需要显式宽度，Feed 才能对齐布局'),
]
