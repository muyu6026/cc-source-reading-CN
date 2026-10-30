# 批注数据：src/utils/glob.ts
# slug: src_utils_glob_ts
ANNOTATIONS = [
    (10, 'after', '''全局文件 glob 工具：基于 ripgrep 的 --files 列出匹配模式的文件，支持绝对路径转相对、忽略模式、隐藏/--no-ignore 开关与孤儿插件目录排除。'''),
    (12, 'after', '''从 glob 模式里抽取「静态基目录」——即第一个通配符（星号、问号、左方括号、左花括号）之前的部分，返回基目录与剩余相对模式。'''),
    (25, 'after', '''若模式里没有通配符，它就是字面路径：把目录部分与文件名拆开返回。'''),
    (42, 'after', '''若通配符前没有路径分隔符，说明模式相对 cwd，基目录置空。'''),
    (50, 'after', '''处理根目录模式（如 Unix 的 /*.txt 或 Windows 的 C:/*.txt）：当 lastSepIndex 为 0 时基目录置空但需补斜杠作为根。'''),
    (56, 'after', '''Windows 盘符根路径（C:/*.txt）：C: 本表示「C 盘当前目录」（相对），需补分隔符成 C:/ 或 C:/ 才是真正盘根。'''),
    (72, 'after', '''主入口：在 cwd 下用 ripgrep 列出匹配模式的文件，支持 limit/offset 分页与 truncated 标记。'''),
    (78, 'after', '''若模式是绝对路径，先抽取基目录并转成相对模式（ripgrep 的 --glob 只吃相对模式）。'''),
    (91, 'after', '''用 ripgrep 而非遍历目录以省内存；注释随后列举各 flag 含义：--files 列文件、--glob 过滤、--sort=modified 按修改时间排序等。'''),
    (98, 'after', '''是否尊重 .gitignore：默认不尊重（--no-ignore），可用环境变量 CLAUDE_CODE_GLOB_NO_IGNORE=false 改变；隐藏文件同理。用 || 而非 ??，以把空串也当作「未设置（默认 true）」。'''),
    (119, 'after', '''调用 ripgrep 拿到相对路径列表。'''),
    (126, 'after', '''按 limit/offset 切片，超界则标记 truncated。'''),
]
