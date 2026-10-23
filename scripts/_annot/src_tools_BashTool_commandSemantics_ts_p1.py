ANNOTATIONS = [
    (1, 'after', r'''退出码语义表：很多命令用退出码传信息而不是成败。grep 返回 1 = 没匹配，这不是错误——把退出码一律当失败的 UI 会满屏假红。'''),
    (10, 'after', r'''CommandSemantic 签名：(exitCode, stdout, stderr) → { isError, message? }。stdout/stderr 参数大部分语义函数没收（下划线前缀），留给将来需要输出内容的判断。'''),
    (19, 'after', r'''DEFAULT_SEMANTIC：只有 0 算成功。'''),
    (31, 'after', r'''COMMAND_SEMANTICS 按基名查。注意没有管道感知——管道命令的退出码取哪段由调用方决定（见下面启发式提取）。'''),
    (32, 'after', r'''grep/rg：0=有匹配，1=无匹配（给人类消息 No matches found），2+=真错误。'''),
    (50, 'after', r'''find：1=部分目录不可访问（常见，如权限拒绝），不当错误。'''),
    (60, 'after', r'''diff：1=文件有差异（这是 diff 的正常用途！），不当错误。'''),
    (69, 'after', r'''test/[: 1=条件为假——test 的全部意义就在退出码里，1 是正常答案。'''),
    (87, 'after', r'''wc/head/tail/cat 等用默认语义（它们只会在真错误时失败）。'''),
    (101, 'after', r'''extractBaseCommand：取第一个词。**函数注释自己承认 May get it super wrong - don't depend this for security**——仅供展示层解释退出码。'''),
    (108, 'after', r'''启发式取管道**最后一段**的基名：shell 默认把最后一段的退出码当整条管道退出码。'''),
    (121, 'after', r'''interpretCommandResult 是出口：command → 语义函数 → isError/message。BashToolResultMessage 的 returnCodeInterpretation 字段由它填。'''),
]
