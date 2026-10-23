# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (8, 'after', '''// 「近期交互」阈值 6 秒：超过这个时间没输入才允许弹通知，避免刚操作完就打扰。'''),
    (19, 'after', '''// 跳过测试环境（NODE_ENV==='test' 不弹，防测试里噪声）+ 要求确实有一段时间没交互。'''),
    (23, 'after', '''// 交互时间追踪已移到 App.tsx 的 processKeysInBatch：收到任何输入就打点，\n// 避免再开一个 stdin 'data' 监听与主线 'readable' 抢输入导致丢字符。'''),
    (44, 'after', '''// 必须在 effect 内立即重置交互时间：useEffect 跑在 Ink 渲染刷新之后，\n// 不立即打点时间戳会滞留，用户空闲时本应延迟的通知会误触发。'''),
]
