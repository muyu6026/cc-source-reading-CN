# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (6, 'after', '''// 被查看的队友被杀/出错时自动退出查看模式；但已完成的队友保留，方便回看完整转录。'''),
    (14, 'after', '''// 只选「被查看的那条 task」而非整张 tasks map：否则任何队友的流式更新都会重渲染本 hook。'''),
    (31, 'after', '''// 判断「任务已从 map 中消失」要用原始 task 而非 teammate 收窄后的 viewedTask——\n// local_agent 任务存在但收窄成 undefined，会立刻误踢出查看。'''),
    (44, 'after', '''// 自动退出条件：队友 killed / failed / 有 error / 或状态既非 running 也非 completed 也非 pending；\n// 下面这段状态判定只针对 teammate（viewedTask 已收窄），local_agent 的 viewedStatus 为 undefined 全落空不踢。'''),
]
