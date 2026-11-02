# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件生成临时文件路径：默认落在系统临时目录，文件名由随机 UUID 或内容 SHA-256 前缀构成，用于把大段内容（如提示缓存用的拒绝列表）落盘成稳定文件。'''),
    (19, 'before', '''generateTempFilePath：可选前缀与扩展名（默认 claude-prompt / .md）。传入 contentHash 时用其 SHA-256 前 16 位作稳定标识，保证跨进程相同内容得到相同路径（避免随机 UUID 每次子进程都变、击穿提示缓存前缀）；否则用随机 UUID。'''),
]
