ANNOTATIONS = [
    (1, 'after', r'''DESCRIPTION 与 PROMPT 同文件导出。'''),
    (3, 'before', r'''PROMPT 大模板字符串（模型操作手册）。只锚这一段边界——内部是纯文案，逐行锚点会被模板字符串保护机制外移，没有意义。'''),
    (13, 'after', r'''完成判据四条照搬框架语义：测试在挂/实现不完整/有未解决错误/找不到文件——有一条就保持 in_progress，不许自欺。'''),
    (41, 'after', r'''状态机一段：pending → in_progress → completed，deleted 是旁路动作。'''),
    (47, 'after', r'''Staleness 一节要求改前先 TaskGet——防基于过期 subject 做判断（比如重复完成一个已被别人删掉的任务）。'''),
    (73, 'after', r'''示例段五连：in_progress / completed / deleted / 认领（owner）/ 依赖（addBlockedBy）——五种典型调用各给一个最小 JSON。'''),
]
