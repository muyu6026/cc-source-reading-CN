# -*- coding: utf-8 -*-
# 第 166 批：src/outputStyles/loadOutputStylesDir.ts 批注数据
ANNOTATIONS = [
    (1, 'before', '''lodash memoize：缓存目录扫描结果避免重复 IO。'''),
    (3, 'before', '''输出样式配置类型与 markdown 工具导入。'''),
    (13, 'before', '''加载项目与用户 output-styles 目录下的 markdown 并转为样式。'''),
    (26, 'before', '''记忆化的核心加载函数：扫描并解析 output-styles。'''),
    (29, 'after', '''加载指定子目录下的 markdown 文件清单。'''),
    (34, 'after', '''逐个文件映射为样式配置。'''),
    (37, 'after', '''文件名去掉 .md 后缀作为样式名。'''),
    (41, 'after', '''优先取 frontmatter 的 name，否则用文件名。'''),
    (50, 'after', '''description 缺省时从正文提取（多行赋值收尾后注解）。'''),
    (62, 'after', '''解析 keep-coding-instructions 布尔/字符串双形态。'''),
    (65, 'after', '''非插件样式误设 force-for-plugin 时告警并忽略。'''),
    (84, 'after', '''过滤掉解析失败（null）的样式。'''),
    (94, 'before', '''清空各类输出样式缓存。'''),
]
