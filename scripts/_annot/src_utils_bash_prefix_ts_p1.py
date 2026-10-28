# source: src/utils/bash/prefix.ts
ANNOTATIONS = [
    (6, 'after', '''NUMERIC：判断字符串是否纯数字（用于识别非命令的参数）。'''),
    (7, 'after', '''ENV_VAR：识别 KEY=value 形式的环境变量赋值（前缀里要单独处理）。'''),
    (12, 'after', '''WRAPPER_COMMANDS：选项位置不固定的包装命令集合（目前只有 nice）。'''),
    (14, 'after', '''toArray：把单值或数组统一成数组，便于按 args 配置遍历。'''),
    (21, 'after', '''isKnownSubcommand：判断某参数是否为规范里声明的子命令（区分包装命令与其子命令）。'''),
    (32, 'after', '''getCommandPrefixStatic：递归解析单条命令的前缀——判断是包装命令还是普通命令，分别走 handleWrapper 或 buildPrefix。'''),
    (33, 'after', '''递归护栏：包装层数大于 2 或递归深度大于 10 直接返回 null，防止失控。'''),
    (77, 'after', '''handleWrapper：处理 nice 这类包装命令——定位其中的真命令参数，递归取它的前缀再拼回。'''),
    (138, 'after', '''getCompoundCommandPrefixesStatic：对 &&/||/; 复合命令逐段取前缀，再按首词分组做词对齐最长公共前缀折叠。'''),
    (160, 'after', '''按前缀的首词（根命令）分组，同根的前缀归到一组再做折叠。'''),
    (182, 'after', '''longestCommonPrefix：按空格分词后逐词比对，取所有字符串共享的最长词前缀（单条直接返回）。'''),
]
