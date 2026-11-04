# -*- coding: utf-8 -*-
# annotations for src/components/FeedbackSurvey/useDebouncedDigitInput.ts (83 lines)
ANNOTATIONS = [
    (8, 'before', '默认防抖 400 毫秒：注释把权衡写清——短到按下去感觉即时，长到用户继续打字时能取消'),
    (18, 'before', 'hook：监听主输入框里打出的单个数字键，防抖后从输入里剔掉这个字符并回调——为的是避免编号列表被误当成选项'),
    (35, 'after', 'initialInputValue 用 ref 记住首帧值：只有真正新增字符才算「用户刚输入」，首帧就带着数字不算'),
    (36, 'after', 'hasTriggeredRef：once 模式只允许触发一次，问卷里防重复提交'),
    (41, 'after', 'latest-ref 模式：回调存进 ref，调用方传内联箭头也不会让 effect 重跑、不会重置防抖计时器'),
    (46, 'after', '未启用或 once 已触发直接返回：不装计时器'),
    (49, 'after', '进入 effect 先清掉旧计时器：每次输入变化都重新计时'),
    (55, 'after', 'normalizeFullWidthDigits：全角数字先转半角再校验，中文输入法下打出的 １ 也要认'),
    (57, 'after', 'trimmed 去掉末尾那个数字，稍后写回输入框'),
    (59, 'after', 'setTimeout 用可变参数形式把 ref 与值一并传入：回调里拿到的都是触发时刻的快照，不依赖闭包'),
    (62, 'after', '到点才真正改输入并回调：防抖窗口内用户继续打字，计时器会被上面的清理逻辑取消'),
    (75, 'after', '清理函数同样清计时器：卸载或输入变化都不留悬挂回调'),
]
