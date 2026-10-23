# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (36, 'after', '''// 主 hook：终端失焦满 5 分钟后，追加一条「while you were away」摘要消息。'''),
    (51, 'after', '''// 3P 默认关闭的 feature 开关（tengu_sedge_lantern），缓存值可能略旧但足够做门控。'''),
    (54, 'after', '''// 双门控：编译期 feature('AWAY_SUMMARY') 关则整段跳过，
// 运行时 GB 关则不启用——两层都开才真正挂载逻辑。'''),
    (69, 'after', '''// generate：先中止在途请求，再生成摘要文本，
// 文本非空且未被中止才插入消息。'''),
    (83, 'after', '''// 失焦定时器触发：若正有回合在进行，标记为 pending 等回合结束再发。'''),
    (92, 'after', '''// 焦点变化处理：blur → 起 5 分钟定时器；focus → 清定时器并放弃 pending；
// unknown（终端不支持 DECSET 1004）为 no-op。'''),
    (119, 'after', '''// 第二 effect：回合进行中定时器触发时，回合一结束（isLoading 变 false）
// 且仍失焦就补发摘要。'''),
]
