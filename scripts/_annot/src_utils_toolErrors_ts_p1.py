# 数据文件：src/utils/toolErrors.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/toolErrors.ts'

ANNOTATIONS = [
    (3, 'after', '导入 ZodError 类型、AbortError/ShellError 以及工具中断提示常量。'),
    (22, 'after', 'formatError：把任意错误统一成多行文本；超过 1 万字则首尾各保留 5000 字并在中间截断，避免超大输出撑爆上下文。'),
    (41, 'after', 'getErrorParts：按错误类型拆出消息、退出码、stderr、stdout 等片段，供 formatError 拼接。'),
    (57, 'after', 'formatValidationPath：把 Zod 校验路径数组渲染成 todos[0].activeForm 这种可读字符串。'),
    (132, 'after', 'formatZodValidationError：把 Zod 校验错误转成对人/对模型友好的报错，区分缺参、未知参数与类型不匹配，并列出期望与实际的类型。'),
]
