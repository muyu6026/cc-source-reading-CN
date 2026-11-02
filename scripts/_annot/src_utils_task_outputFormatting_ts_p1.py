# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件负责「任务输出」的格式化与截断：把工具或任务产生的长文本裁剪成 API 可消费的体量，超出上限时附上完整文件路径供后续查阅。'''),
    (4, 'before', '''TASK_MAX_OUTPUT_UPPER_LIMIT 与 TASK_MAX_OUTPUT_DEFAULT：任务输出长度的上限与默认值（分别为 160000 与 32000 字符）。'''),
    (7, 'before', '''getMaxTaskOutputLength：读取 TASK_MAX_OUTPUT_LENGTH 环境变量，经有界整数校验后返回当前生效的最大输出长度。'''),
    (22, 'before', '''formatTaskOutput：若输出未超上限则原样返回；超限则保留末尾 availableSpace 字符，并在头部加上「完整输出位于 filePath」的提示，标记 wasTruncated 为 true。'''),
]
