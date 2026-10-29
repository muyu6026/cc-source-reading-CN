# 批注数据：src/utils/deepLink/parseDeepLink.ts

ANNOTATIONS = [
    (1, 'after', '''本文件解析 claude-cli 协议的深链 URI：参数 q、cwd、repo 均可选，
安全上做 URL 解码、Unicode 清理并拒绝控制字符，注入边界在使用点由单引号转义承担。'''),
    (29, 'after', '''引入 Unicode 部分清理函数，用于剥离隐藏字符防止提示注入。'''),
    (31, 'after', '''containsControlChars 检查字符串是否含 ASCII 控制字符（可作命令行分隔符），放行可打印与 Unicode。'''),
    (44, 'after', '''containsControlChars 收尾：逐字符判断码点是否落在控制区间。'''),
    (46, 'after', '''REPO_SLUG_PATTERN 约束 owner/repo 格式：字母数字点连字符下划线加恰好一个斜杠，防止路径穿越。'''),
    (50, 'after', '''REPO_SLUG_PATTERN 常量：用正则约束仓库短标识，避免变成路径遍历向量。'''),
    (52, 'after', '''MAX_QUERY_LENGTH 限制预填提示长度：过长不可一眼扫完，宁可拒绝也不截断以免改变语义。'''),
    (70, 'after', '''MAX_QUERY_LENGTH 常量：五千字符是实用上限，顾及 Windows 命令串长度与转义膨胀。'''),
    (72, 'after', '''MAX_CWD_LENGTH 限制工作目录长度：超过 PATH_MAX 即视为畸形或恶意。'''),
    (77, 'after', '''MAX_CWD_LENGTH 常量：Linux 路径上限与 Windows 上限之大者，真实路径不可能逼近。'''),
    (79, 'after', '''parseDeepLink 把 URI 解析为结构化动作，URI 畸形或含危险字符时抛错。'''),
    (153, 'after', '''parseDeepLink 收尾：校验 cwd 与 repo 格式、清理并限长后返回动作对象。'''),
    (155, 'after', '''buildDeepLink 反向构造 claude-cli 深链 URL，按需设置 q、cwd、repo 三个查询参数。'''),
    (170, 'after', '''buildDeepLink 收尾：用 URL 对象装配查询参数并返回字符串。'''),
]
