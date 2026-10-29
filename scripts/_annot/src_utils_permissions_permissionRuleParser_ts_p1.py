ANNOTATIONS = [
    (16, 'after', '''BRIEF_TOOL_NAME 通过条件 require 获取 ANT 专属工具名，受 KAIROS 特性门控以避免泄漏到外部构建。'''),
    (29, 'after', '''LEGACY_TOOL_NAME_ALIASES 把旧工具名映射到当前规范名，工具改名后权限规则与 hook 仍能解析到正确名称。'''),
    (33, 'after', '''normalizeLegacyToolName 收尾：查别名表，未命中则返回原名。'''),
    (41, 'after', '''getLegacyToolNames 收尾：反向查表，返回某规范名对应的所有历史旧名。'''),
    (60, 'after', '''escapeRuleContent 收尾：转义顺序为先反斜杠后括号，确保规则内容在 `Tool(content)` 格式中安全存储。'''),
    (79, 'after', '''unescapeRuleContent 收尾：按相反顺序（先括号后反斜杠）还原转义内容。'''),
    (93, 'before', '''permissionRuleValueFromString 把 `ToolName` 或 `ToolName(content)` 字符串解析为工具名与可选内容，处理转义括号。'''),
    (133, 'after', '''permissionRuleValueFromString 收尾：各种畸形（缺括号、缺工具名、尾随内容、空或通配）都安全回退为纯工具名。'''),
    (144, 'before', '''permissionRuleValueToString 把规则值序列化为字符串表示，对内容中的括号做转义。'''),
    (152, 'after', '''permissionRuleValueToString 收尾：无内容时只返回工具名。'''),
    (175, 'after', '''findFirstUnescapedChar 收尾：向前统计反斜杠个数，偶数为未转义，返回首个未转义字符下标。'''),
    (198, 'after', '''findLastUnescapedChar 收尾：从末尾反向扫描，同样以反斜杠奇偶判定是否转义。'''),
]
