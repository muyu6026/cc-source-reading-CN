# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'after', '''可中止的 sleep：等够毫秒数就 resolve，signal 中止就立刻返回。退避重试里用它，进程关停时才不会被一个长 sleep 卡住。'''),
    (30, 'after', '''先判已中止再建定时器：这个顺序是被 TDZ 逼出来的——若先定义 onAbort 再同步调用，它会引用还没赋值的 timer。'''),
    (40, 'after', '''定时器回调把三个参数一起带进来：signal 与 onAbort 用于清监听器，resolve 用于兑现 Promise，避免回调闭包里再抓外层变量。'''),
    (49, 'after', '''once 为 true：中止只可能发生一次，监听器用完即弃，不需要手动摘除也能被回收。'''),
    (54, 'after', '''默认中止是静默 resolve：调用方 await 之后要自己检查 signal.aborted；需要让异常冒泡的场合才传 throwOnAbort 或 abortError。'''),
    (58, 'after', '''独立成一个具名函数是为了给 setTimeout 当参数用：内联箭头会多一层闭包，也没法在定时器回调里被引用。'''),
    (79, 'after', '''timeout 的定时器也要 unref：超时守卫本身不该成为「进程还有活干」的理由，否则一个已经没人等的 Promise 能把退出拖到天荒地老。'''),
    (84, 'after', '''withTimeout 只归还控制权，不取消底层工作：底层如果是跑飞的异步任务，它会继续跑，调用方需要自己处理这个语义差异。'''),
]
