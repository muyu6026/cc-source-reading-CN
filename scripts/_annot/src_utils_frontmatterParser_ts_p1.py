# -*- coding: utf-8 -*-
# src/utils/frontmatterParser.ts（371 行）批注数据
ANNOTATIONS = [
    (59, 'after', '''`FrontmatterData` 定义 frontmatter 各字段的类型与含义说明。'''),

    (64, 'after', '''`ParsedMarkdown` 同时携带解析出的 frontmatter 与正文内容。'''),

    (79, 'after', '''`YAML_SPECIAL_CHARS` 匹配需要在值两侧加引号的 YAML 特殊字符。'''),

    (85, 'after', '''`quoteProblematicValues` 预处理：给含特殊字符的未引号值补上双引号。'''),

    (121, 'after', '''预处理函数结束，逐行处理 key: value 对。'''),

    (123, 'after', '''`FRONTMATTER_REGEX` 匹配由 `---` 包裹的 frontmatter 区块。'''),

    (134, 'after', '''用正则从原始 markdown 中提取 frontmatter 文本与正文。'''),

    (142, 'after', '''未找到 frontmatter 时返回空对象与原文。'''),

    (145, 'after', '''切出 frontmatter 文本与剩余正文两段。'''),

    (152, 'after', '''YAML 解析成功且为对象时采用其结果。'''),

    (169, 'after', '''解析失败记日志（warn 级）并保持 frontmatter 为空，便于用户诊断。'''),

    (175, 'after', '''`parseFrontmatter` 结束，返回 frontmatter 与正文。'''),

    (189, 'after', '''`splitPathInFrontmatter` 拆分逗号分隔串并展开花括号模式，也接受 YAML 列表。'''),

    (197, 'after', '''按逗号切分但尊重花括号层级，括号内逗号不当作分隔符。'''),

    (229, 'after', '''展开每个分片里的花括号后再返回。'''),

    (232, 'after', '''拆分函数结束。'''),

    (240, 'after', '''`expandBraces` 递归展开形如 `src/*.{ts,tsx}` 的花括号模式。'''),

    (266, 'after', '''展开函数结束。'''),

    (275, 'after', '''`parsePositiveIntFromFrontmatter` 从 frontmatter 解析正整数，非法或缺省返回 undefined。'''),

    (289, 'after', '''正整数解析结束。'''),

    (304, 'after', '''`coerceDescriptionToString` 校验并转换描述字段，非标量记日志后省略。'''),

    (326, 'after', '''描述转换结束，空串与 null 返回 null 以便调用方回退默认。'''),

    (332, 'after', '''`parseBooleanFrontmatter` 仅字面 true 或字符串 true 为真。'''),

    (334, 'after', '''布尔解析结束。'''),

    (339, 'after', '''`FrontmatterShell` 限定为 `bash` 或 `powershell` 两种取值。'''),

    (341, 'after', '''`FRONTMATTER_SHELLS` 合法的 shell 取值列表。'''),

    (370, 'after', '''`parseShellFrontmatter` 解析并校验 `shell:` 字段，非法值记警告并回退 bash。'''),
]
