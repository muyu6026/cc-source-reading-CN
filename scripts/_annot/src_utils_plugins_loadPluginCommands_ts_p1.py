# 批注数据：src/utils/plugins/loadPluginCommands.ts
# slug = src_utils_plugins_loadPluginCommands_ts
ANNOTATIONS = [
    (38, 'before', '''插件来源的 markdown 文件结构：记录文件路径、基准目录、frontmatter 与正文内容，类似 MarkdownFile 但专为插件来源定义。'''),
    (46, 'before', '''加载配置：isSkillMode 为真时表示从 skills/ 目录加载（会影响命名空间与进度文案）。'''),
    (53, 'before', '''判断一个文件是不是 skill 文件：文件名正则匹配 skill.md（大小写不敏感）。'''),
    (60, 'before', '''从文件路径算出命令名：skill 用「父目录名」当基础名、用「父目录的父目录相对 baseDir」拼命名空间；普通文件用「文件名去 .md」当基础名、用「文件所在目录相对 baseDir」拼命名空间。最终形如 pluginName:命名空间:基础名 或 pluginName:基础名。'''),
    (102, 'before', '''递归收集一个目录下的所有 markdown 文件：交给 walkPluginMarkdown 遍历（遇到 skill 目录就停），用 isDuplicatePath 去重，解析出 frontmatter 与正文后收进列表。'''),
    (135, 'before', '''把收集到的文件按「所在目录」分组，处理 skill 目录：一个目录里若有 SKILL.md 就只保留第一个（多个时打调试日志），否则保留该目录下全部文件。'''),
    (169, 'before', '''从某个 commands 目录加载命令：先收集 markdown、再跑 skill 变换、然后对每份文件算命令名并调 createPluginCommand 造命令，过滤掉造不出来的。'''),
    (218, 'before', '''从一份插件 markdown 造出一个 Command：解析描述（frontmatter 优先，否则从正文抽）、allowed-tools（先替换 CLAUDE_PLUGIN_ROOT 再解析成工具列表）、参数名、model / effort / 是否用户可调用等 frontmatter；最后返回一个 type:prompt 的命令对象，其 getPromptForCommand 负责把正文里的变量都替换好再交给模型。'''),
    (325, 'before', '''命令的 getPromptForCommand 装配管线：先按 skill 模式决定是否在正文前加「技能基准目录」；再依次替换参数、CLAUDE_PLUGIN_ROOT / CLAUDE_PLUGIN_DATA、user_config 变量（敏感键只替换成占位符，绝不把秘密写进模型提示词）、CLAUDE_SKILL_DIR、CLAUDE_SESSION_ID，最后跑正文里的 shell 命令并把 allowedTools 注入为 alwaysAllowRules。'''),
    (402, 'after', '''createPluginCommand 返回的命令对象用 satisfies Command 收口：把禁用模型调用、隐藏（不可用户调用时）、进度文案（skill 用 loading、普通命令用 running）、userFacingName（优先显示名）等都在这个对象里定好。'''),
    (414, 'before', '''(memoize) 取出全部「插件命令」：裸模式（--bare）且没有显式 --plugin-dir 时直接返回空；否则只从「已启用插件」加载，并行处理每个插件（各自维护 loadedPaths 去重）。每个插件先从默认 commands 目录、再到 manifest 里的额外 commandsPaths（目录 / 单文件 / 带元数据）、最后到「内联内容」三种来源加载。'''),
    (677, 'after', '''把所有插件各自产出的命令数组合并摊平，返回全局插件命令列表；失败与加载数量都打调试日志。'''),
    (679, 'before', '''清空插件命令的 memoize 缓存：直接清 getPluginCommands 的缓存。'''),
    (687, 'before', '''从插件的 skills 目录加载技能：先查 skillsPath 自身是否直接是 skill 目录（含 SKILL.md），是就直接加载；否则遍历子目录找里面的 SKILL.md（目录与符号链接都接受）。每个找到的 SKILL.md 调 createPluginCommand 并以 isSkill 模式造命令。'''),
    (840, 'before', '''(memoize) 取出全部「插件技能」，门禁与 getPluginCommands 一致（裸模式 + 无 --plugin-dir 返回空）；同样只从已启用插件并行加载，每个插件先默认 skills 目录、再到 manifest 里的额外 skillsPaths。'''),
    (944, 'before', '''清空插件技能的 memoize 缓存。'''),
    (942, 'after', '''把所有插件各自产出的技能数组合并摊平，返回全局插件技能列表。'''),
]
