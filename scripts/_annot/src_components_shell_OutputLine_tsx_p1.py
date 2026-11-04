# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (12, 'before', 'tryFormatJson：单行若是合法 JSON 就美化重排。核心防线在第 21 行——解析再序列化是有损变换，大整数超过 MAX_SAFE_INTEGER 会悄悄变值，所以先做往返一致性校验。'),
    (21, 'before', '往返校验的归一化：两侧都去空白、原文侧再去斜杠转义（JSON 里斜杠转义合法但可选）。归一化后不相等即判定精度丢失，返回原始行不美化——宁可不格式化也不改数值。'),
    (27, 'before', '校验通过才做两空格缩进的美化输出。jsonParse 与 jsonStringify 来自 slowOperations 模块——大 JSON 的解析要走慢路径保护。'),
    (32, 'before', '整体长度上限 1 万字符：超长内容直接跳过逐行 JSON 探测——对十 KB 以上的输出做逐行 try-parse 得不偿失。'),
    (43, 'before', 'URL 正则的保守策略：不含引号、空白和尖括号反斜杠——宁可漏掉边界情况也不把 JSON 结构字符（收尾的逗号、括号）吞进链接。'),
    (44, 'before', 'linkify 用 createHyperlink 生成 OSC 8 转义序列：终端支持时显示可点击链接，不支持时退化为原文，零成本降级。'),
    (47, 'before', 'OutputLine：Shell 输出行的统一渲染入口——JSON 自动美化、URL 自动链接、按 verbose 与展开状态决定截断。_c(11) 三段缓存。'),
    (61, 'before', '全量显示的两个开关：verbose（verbose 模式或该消息被标记）或 expandShellOutput 上下文（用户按过展开快捷键）。任一为真就不截断。'),
    (64, 'before', 'bb0 标签块：编译器把 if 早退重写成 break bb2 风格的带标签块——全量与截断两条路径在块内各自给 t1 赋值后跳出，不是业务语法。'),
    (73, 'before', '截断路径：renderTruncatedContent 按终端列宽截断，inVirtualList 为真时用虚拟列表的截断口径——同一内容在两种容器里截法不同。'),
    (85, 'before', '颜色按 isError 与 isWarning 二选一，普通输出不着色——着色决策与内容决策分开缓存。'),
    (106, 'before', '注释坦白了一个未解之谜：下划线 ANSI 码特别容易泄漏，连补发重置码都拦不住，原因不明；而全剥 ANSI 又会丢失用户要的格式——所以只精准剥下划线类码，其余原样保留。工程上「承认未知、收窄处理面」的范例。'),
]
