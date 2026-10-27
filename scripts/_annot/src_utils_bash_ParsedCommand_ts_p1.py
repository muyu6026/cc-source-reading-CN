ANNOTATIONS = [
    (11, 'after', '''解析 shell 命令（管道与输出重定向）：tree-sitter 可用时做引号感知解析，否则回退到正则实现。'''),
    (32, 'after', '''IParsedCommand：解析命令的统一接口，两种实现（tree-sitter 与正则兜底）都遵循它。'''),
    (99, 'after', '''RegexParsedCommand_DEPRECATED：仅 tree-sitter 不可用时使用的正则兜底实现，导出供测试。'''),
    (129, 'after', '''extractPipePositions：收集管道符号的字节位置并按升序排序，保证 getPipeSegments 从左到右切片。'''),
    (149, 'after', '''extractRedirectionNodes：遍历 AST 提取文件重定向节点（目标与操作符）。'''),
    (238, 'after', '''TreeSitterParsedCommand：主实现，关键点是用 UTF-8 字节偏移切片字符串，避免多字节码位导致切到半截字符。'''),
    (268, 'after', '''buildParsedCommandFromRoot：从已解析的 AST 根构造，省去重复的原生解析调用。'''),
    (318, 'after', '''ParsedCommand.parse：单条命令缓存入口，复用最近一次解析结果以避免重复 tree-sitter 遍历开销。'''),
]
