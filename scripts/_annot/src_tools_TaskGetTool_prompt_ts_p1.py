ANNOTATIONS = [
    (1, 'after', r'''DESCRIPTION 与 PROMPT 同文件导出。'''),
    (3, 'before', r'''PROMPT 大模板字符串（模型操作手册）。内部是纯文案，逐行锚点会被模板字符串保护机制外移到段尾。'''),
    (9, 'after', r'''使用场景三条：动手前拿完整需求 / 弄清依赖方向 / 被派活后核对判据。'''),
    (13, 'after', r'''Output 一节逐字段解释，与 TaskGetTool.ts 的 outputSchema 一一对应。'''),
    (22, 'after', r'''Tips 第一条是硬规矩：动手前先确认 blockedBy 为空，否则很可能在做一件还被堵着的事。'''),
]
