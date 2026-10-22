ANNOTATIONS = [
    (30, 'after',
     "从候选里挑「最久没出现过的那条」。sessions 是「距上次显示经过几个启动周期」，从未显示过的是 Infinity——所以新 tip 一定最先轮到，这是设计意图：新功能要趁用户还新鲜时露脸。降序 sort 取 [0]，两条并列时按原数组顺序稳定。注意这里只排不滤，冷却过滤已在 getRelevantTips 里做过。"),
    (46, 'after',
     "spinner 的总入口。先查总开关 spinnerTipsEnabled（默认 true——settings 里只有显式 false 才关闭，没这个键时 undefined !== false 照常显示），再取相关列表，最后交给 selectTipWithLongestTimeSinceShown。空列表返回 undefined，调用方（spinner）就什么都不显示。"),
    (58, 'after',
     "显示后落账 + 遥测。两件事必须一起做：recordTipShown 写冷却账本（决定下次什么时候能再出现），logEvent('tengu_tip_shown') 发分析事件。注意遥测发的是 tipIdLength 而不是 tipId——tip id 里可能带用户信息（自定义 tip 的 id 来自用户设置），只发长度既够做聚合统计又不碰 PII，这是 api/logging.ts 那套 _I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS 命名约束的又一应用。"),
]
