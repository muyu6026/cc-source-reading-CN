ANNOTATIONS = [
    (1, 'after', """`/cost` 实现体（被 `cost/index.ts` 懒加载）：按需展示会话总成本与耗时。"""),
    (7, 'after', """订阅用户走专属分支：按是否超额计费给不同文案，并额外打印总成本。"""),
    (18, 'after', """内部员工（USER_TYPE=ant）无论订阅与否都强制显示成本明细，便于调试计费。"""),
    (23, 'after', """非订阅用户的兜底：直接返回格式化后的总成本文本。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
