# 数据文件：source/src/query/deps.ts
ANNOTATIONS = [
    (1, 'after', """query() 的 I/O 依赖注入类型：把 callModel/压缩/uuid 等抽出来，测试可直接塞假实现，省去逐模块 spyOn 的样板。"""),
    (8, 'after_block', """依赖范围刻意收窄到 4 个，用来验证这套注入模式；后续 PR 可再加 runTools/handleStopHooks 等。用 typeof fn 让签名与真实实现自动同步，且不引入新的模块图成本。"""),
    (21, 'after', """依赖契约类型：用 typeof fn 让签名与真实实现自动同步。"""),
    (22, 'after', """模型调用依赖。"""),
    (26, 'after', """微压缩依赖。"""),
    (33, 'after', """生产工厂：把真实函数装进对象，作为默认依赖。"""),
]
