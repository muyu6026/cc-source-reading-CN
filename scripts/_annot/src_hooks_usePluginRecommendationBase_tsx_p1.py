# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (2, 'after', '''// 块注释：插件推荐 hook 的共享状态机 + 安装辅助（LSP / claude-code-hint 共用）；集中 gate 链、async 守卫、成功/失败通知 JSX，让新来源保持精简。'''),
    (18, 'after', '''// 块注释：在 useEffect 内调用 tryResolve，它套标准 gate（remote 模式 / 已有 recommendation / 在飞）后跑 resolve；非空返回即推荐；tryResolve 必须进 effect deps（身份随 recommendation 变，清掉会重触发解析）。'''),
    (24, 'after', '''// React Compiler 产物：函数名保留但参数被抹平；返回 {recommendation, clearRecommendation, tryResolve} 三元组。'''),
    (48, 'after', '''// gate 链：getIsRemoteMode / 已有 recommendation / isCheckingRef 在飞——三道闸都过才 resolve；isCheckingRef 防重入，.finally 复位（catch 也走 logError）。'''),
    (62, 'after', '''// $[2] 缓存 clearRecommendation（sentinel 首次初始化），恒返回 setRecommendation(null)，用于清除当前推荐重触发解析。'''),
    (104, 'after', '''// installPluginAndNotify：查插件 → install → 成功（tick + restart to apply）或失败（logError + 失败通知）；keyPrefix 区分来源（LSP / claude-code-hint）。'''),
]
