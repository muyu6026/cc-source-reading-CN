# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (12, 'before', '''// 把 SessionStart 等延迟 hook 消息「先渲染后注入」，避免 REPL 阻塞在 hook 执行（约 500ms）。'''),
    (16, 'after', '''// 两个 ref：pendingRef 持有未决 promise，resolvedRef 标记是否已结算（决定回调是否还要等）。'''),
    (28, 'after', '''// promise 结算后把消息前置插入对话（[...msgs, ...prev]），确保模型首轮就能看到 hook 上下文。'''),
    (38, 'after', '''// 返回的回调供 onSubmit 在首个 API 请求前调用：已结算或无可等则直接返回，否则 await 后注入。'''),
]
