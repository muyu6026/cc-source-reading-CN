# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (10, 'after', '''// 单文件超过 400 行的 diff 视为过大，触发截断标记。'''),
    (34, 'after', '''// 按需获取 git diff 数据（stats + hunks），挂载时一次性拉取。'''),
    (42, 'after', '''// 挂载并行拉取 stats 与 hunks 两份数据，缩短首屏等待。'''),
    (69, 'after', '''// 卸载时置 cancelled，防止卸载后的 setState 警告。'''),
    (88, 'after', '''// large file 判定：出现在 perFileStats 却不在 hunks 里（且非二进制/未跟踪），
// 说明文件过大被跳过 hunk 提取。'''),
    (93, 'after', '''// truncated 判定：非大文件、非二进制，且增删总行数超过 400 上限。'''),
]
