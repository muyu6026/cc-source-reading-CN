"""批注数据：src/tools/GrepTool/prompt.ts（18 行）"""

ANNOTATIONS = [
    (10, 'after', "描述第一条就是禁令：永远用 Grep 工具、永远不要在 Bash 里跑 grep/rg。理由写在句尾——Grep 工具「针对正确权限与访问做过优化」（deny 规则、ignore 规则、UNC 防护都接上了），绕过工具直接调命令等于绕开所有这些防护。getDescription 是函数而非常量，因为文案里引用了 Bash/Agent 的工具名（从各自模块 import，避免硬编码字符串漂移）。"),
    (16, 'after', "两条给模型的语法提示：花括号要转义（rg 不是 grep，interface{} 得写成 interface\\{\\}）；跨行 pattern 默认匹配不到，必须显式开 multiline。这两条是模型实际使用中最高频的翻车点，直接写进描述省排查。"),
]
