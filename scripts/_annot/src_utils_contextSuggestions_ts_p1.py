# -*- coding: utf-8 -*-
# 批注：src/utils/contextSuggestions.ts
ANNOTATIONS = [
    (11, 'after', '建议分两级：普通提示 info 与告警 warning'),
    (19, 'after', '单条建议的结构：级别、标题、详情与可省下的 token 估计'),
    (27, 'after', '触发建议的若干阈值：工具结果占比、读文件占比、接近容量、记忆占比等'),
    (31, 'before', '主入口：依次跑五类检查，最后按「告警优先、可省 token 降序」排序'),
    (55, 'before', '接近容量上限时给告警，提示用 /compact 控制保留内容'),
    (70, 'before', '逐个工具统计 token 占用，超阈值的按工具类型给裁剪建议'),
    (98, 'before', '按工具类型生成对应的裁剪建议：Bash 走管道、Read 用偏移、Grep 加 glob、WebFetch 只取要点'),
    (151, 'before', '读文件结果本身过大时的专项建议（与上面的工具阈值互补，避免重复报）'),
    (187, 'before', '记忆文件总占用过高时列出最大的几个，提示用 /memory 清理'),
    (219, 'before', '自动压缩被关且上下文已过半时，提醒开启以免撞上限丢对话'),
]
