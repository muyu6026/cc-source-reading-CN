# 批注数据：source/src/commands/pr_comments/index.ts
# slug: src_commands_pr_comments_index_ts_p1
# 注意：第 13–46 行为模板字符串（反引号），按规则不得在模板串内部落注释，
# 故本文件锚点只落在模板串之外的代码结构行。

ANNOTATIONS = [
    (1, 'after', '复用「已迁移到插件」命令工厂，把本命令重定向到插件实现。'),
    (3, 'after', '默认导出 pr-comments 命令定义，声明名称、描述、进度提示与插件名，运行时由插件加载真正的提示逻辑。'),
    (9, 'after', '市场私有期间的提示构造：返回一组文本提示，指导模型用 gh 拉取并格式化 GitHub PR 评论。'),
    (48, 'after', '提示对象与外层数组收尾。'),
    (50, 'after', '工厂调用收尾，完成命令定义。'),
]
