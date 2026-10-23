ANNOTATIONS = [
    (1, 'after', r'''命令首行若是 # 注释（不是 #! shebang），摘出来当 UI 标签——全屏模式下这是非 verbose 的工具调用标签和折叠组提示。**是 Claude 写给人看的**，比截断的命令文本友好得多。'''),
    (8, 'after', r'''extractBashCommentLabel 只取第一行：注释必须写在命令最前面才有效。'''),
    (11, 'after', r'''排除 #!：shebang 不是给人看的标签。'''),
    (12, 'after', r'''摘掉开头连续的 # 和空白；只剩 # 号时返回 undefined（空标签不如没有）。'''),
]
