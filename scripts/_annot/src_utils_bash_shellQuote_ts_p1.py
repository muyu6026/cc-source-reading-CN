ANNOTATIONS = [
    (16, 'before', """ShellParseResult：shell 命令解析的统一结果类型，成功时返回 token 数组，失败时返回错误信息。"""),
    (24, 'before', """tryParseShellCommand：对 shell-quote 的 parse 做安全封装，无论是否传入 env 函数都走同一分支，把异常转成结构化错误而非抛出。"""),
    (47, 'before', """tryQuoteShellArgs：对 shell-quote 的 quote 做安全封装，逐个校验参数类型，遇到对象、符号、函数等不支持类型时主动抛错。"""),
    (84, 'after', """通过校验后调用真正的 quote 把参数数组转成可被 shell 安全引用的字符串。"""),
    (117, 'before', """hasMalformedTokens：检测 shell-quote 是否把含歧义的输入（如未闭合花括号、括号、引号）误解析成合法 token，防止命令注入。"""),
    (143, 'after', """双引号或单引号出现奇数次说明原始命令存在未闭合引号，shell-quote 会静默丢弃，因此判定为畸形。"""),
    (190, 'before', """hasShellQuoteSingleQuoteBug：检测 shell-quote 在单引号内错误地把反斜杠当转义符的缺陷，该缺陷会导致注入 payload 被隐藏。"""),
    (267, 'before', """quote：对外统一的引用入口，先尝试严格校验，失败则退回到用 jsonStringify 把不支持类型转成字符串的宽松策略。"""),
    (294, 'after', """宽松回退路径：把非常规类型用 JSON 序列化后交给 shell-quote 生成引用字符串。"""),
    (302, 'after', """安全红线：绝不能用 JSON.stringify 做 shell 引用兜底，因为双引号无法阻止命令执行，必要时直接抛错。"""),
]
