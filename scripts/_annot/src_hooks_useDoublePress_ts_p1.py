# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'after', '''// 双按检测器：在超时窗口内第二次调用触发 onDoublePress，否则走 onFirstPress。'''),
    (6, 'after', '''// 双按判定窗口 800 毫秒：超过这个时间窗口的第二次按就退化成新的「首次按」。'''),
    (30, 'after', '''// 返回的是一个稳定 useCallback：把双按状态机（lastPressRef + timeoutRef）封进闭包。'''),
    (35, 'after', '''// 双按成立的两要件：距上次按 ≤ 800ms（时间窗）且 timeoutRef 还没清（说明上次按之后没超时）。'''),
]
