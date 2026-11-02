ANNOTATIONS = [
    (1, 'after', """模块总述：bash 操作的超时取值工具，提供默认与最大两个档位，均可被对应环境变量覆盖。"""),
    (2, 'after', """两个基础常量：默认 2 分钟、最大 10 分钟，作为环境未配置时的回退值。"""),
    (12, 'before', """getDefaultBashTimeoutMs：读取 `BASH_DEFAULT_TIMEOUT_MS`，解析为非正数或非法时回退到 2 分钟默认。"""),
    (28, 'before', """getMaxBashTimeoutMs：读取 `BASH_MAX_TIMEOUT_MS`，解析有效时取其与默认的大者，否则用 10 分钟与默认的大者，保证最大值不低于默认。"""),
    (38, 'after', """兜底返回：无论环境变量是否配置，最终都取 MAX 与默认超时的大者，确保最大档始终不小于默认档。"""),
]
