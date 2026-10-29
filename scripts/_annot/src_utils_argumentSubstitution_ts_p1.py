# 数据文件：src/utils/argumentSubstitution.ts
SOURCE_PATH = 'src/utils/argumentSubstitution.ts'

ANNOTATIONS = [
    (1, 'after', '''本文件提供技能/命令提示里的 $ARGUMENTS 占位符替换工具：支持全量参数、索引参数（$0/$1）、带方括号索引（$ARGUMENTS[0]）以及具名参数（$foo）。'''),
    (40, 'after', '''parseArguments：用 shell-quote 解析参数串（正确处理引号），失败则回退到按空白切分，并只保留字符串令牌。'''),
    (68, 'after', '''parseArgumentNames：从 frontmatter 的 arguments 字段解析参数名，过滤空串与纯数字名（避免与 $0/$1 简写冲突）。'''),
    (83, 'after', '''generateProgressiveArgumentHint：根据已输入参数生成剩余未填参数的提示串，如 [arg2] [arg3]。'''),
    (124, 'after', '''依次替换索引参数（带方括号与 $N 简写），再整体替换 $ARGUMENTS 为完整参数串。'''),
    (145, 'after', '''substituteArguments：按「具名 → 带索引 → 简写索引 → 全量」顺序完成全部替换；若无占位符且参数为非空，则追加 ARGUMENTS 段。'''),
]
