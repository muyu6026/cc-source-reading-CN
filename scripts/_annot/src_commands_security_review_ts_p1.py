ANNOTATIONS = [
    (1, 'before', '''安全评审命令：组装提示词并包装成插件命令'''),
    (6, 'before', '''SECURITY_REVIEW_MARKDOWN：/security-review 的完整提示词（frontmatter 加安全评审指引）；整段为模板字符串，内部不批注'''),
    (198, 'before', '''默认导出：把提示词包装成 security-review 插件命令'''),
    (205, 'before', '''getPromptWhileMarketplaceIsPrivate：解析 frontmatter、注入允许工具、执行提示词内 shell 命令并返回'''),
    (236, 'before', '''把处理好的提示词作为一条 text 消息返回'''),
    (243, 'after', '''模块结束：命令定义闭合'''),
]
