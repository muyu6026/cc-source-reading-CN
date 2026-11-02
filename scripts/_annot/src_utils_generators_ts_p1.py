# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'after', '''用一个私有 Symbol 当哨兵：生成器可能合法地产出 undefined，用 null 或 undefined 都无法区分「没产出」与「产出了空值」。'''),
    (12, 'after', '''lastX 只保留最后一个值：适合「流式产出中间状态、只关心终态」的场景，空生成器直接抛错而不是返回 undefined。'''),
    (22, 'after', '''returnValue 关注的是生成器的返回值而不是产出值：用 do-while 一路 next 到 done，再把 final value 取出来。'''),
    (29, 'after', '''队列元素自带四件套：done 与 value 来自 next 结果，generator 用于续跑，promise 是它自己的「身份牌」——竞速结束后要靠它把自己从集合里摘掉。'''),
    (46, 'after', '''next 里先把 promise 声明出来再在 then 里回填自身引用：这样每个队列元素都握着自己那一格的 promise，Promise.race 完成后能精确删除。'''),
    (54, 'after', '''初始批次按并发上限先填满：concurrencyCap 默认 Infinity，等于「全部同时开跑」；限流场景传具体数字即可。'''),
    (71, 'after', '''主循环靠 Promise.race 取最快完成的那个：未完成就续跑同一生成器，已完成就从 waiting 里补一个新的进来，因此并发度始终贴着上限。'''),
    (82, 'after', '''toArray 是便捷包装：把生成器彻底抽干成数组，用于「上游是流、下游要数组」的接缝。'''),
    (88, 'after', '''fromArray 是反向适配器：把现成数组包成异步生成器，好让它和 all 这类只吃生成器的组合器直接对接。'''),
]
