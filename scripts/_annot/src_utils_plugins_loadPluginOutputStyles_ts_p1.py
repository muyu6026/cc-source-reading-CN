# 批注数据：src/utils/plugins/loadPluginOutputStyles.ts

ANNOTATIONS = [
    (11, 'after', '''引入加载输出样式所需的依赖：frontmatter 解析、markdown 描述提取、插件缓存与目录遍历等。'''),
    (33, 'after', '''loadOutputStylesFromDirectory 遍历一个目录下的 markdown，逐个调用单文件加载器收集样式。'''),
    (55, 'after', '''样式名以插件名加冒号为前缀做命名空间，与命令和智能体保持一致，避免跨插件重名。'''),
    (70, 'after', '''解析 forceForPlugin 标志：支持布尔与字符串两种写法，其余情况视为未设置。'''),
    (85, 'after', '''loadOutputStyleFromFile 收尾：从单文件解析 frontmatter 与正文，失败只记日志返回空。'''),
    (90, 'after', '''只从已启用插件加载输出样式，先取启用列表与错误列表。'''),
    (124, 'after', '''对每个附加路径分别处理：目录则递归加载，单文件则直接加载，失败各自记日志。'''),
    (174, 'after', '''loadPluginOutputStyles 收尾：聚合并返回所有启用插件下的输出样式，按 memoize 缓存。'''),
    (178, 'after', '''clearPluginOutputStyleCache 清空样式缓存，供配置变更后刷新。'''),
]
