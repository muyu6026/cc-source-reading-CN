# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (16, 'after', '''// 本 hook 驱动统一命令队列的出队：单模块级 store，优先级 now > next(用户输入) > later(任务通知)；\n// 三个触发条件全满足才处理——无 query 进行中、队列非空、无本地 JSX UI 阻塞输入。'''),
    (35, 'after', '''// 订阅 query 守卫：query 开始/结束（或 reserve/cancelReservation 切换 dispatching 态）时重渲染。'''),
    (43, 'after', '''// 用 useSyncExternalStore 订阅队列而非 React context：绕过 context 传播延迟，\n// 否则在 Ink 里会漏掉通知导致出队不及时。'''),
    (53, 'after', '''// 预订（reservation）现由 handlePromptSubmit 持有（在 executeUserInput 的 try 内）；\n// 同步链 executeQueuedInput→handlePromptSubmit→executeUserInput→queryGuard.reserve() 跑在首个真实 await 之前，\n// 所以本 effect 因出队触发快照变化而重跑时，isQueryActive 已是 dispatching，上面的守卫提前返回；\n// handlePromptSubmit 的 finally 通过 cancelReservation() 释放（若 onQuery 已 end 则为 no-op）。'''),
]
