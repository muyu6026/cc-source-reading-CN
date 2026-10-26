# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (12, 'before', '''// 薄封装 hook：仅把「官方市场自动安装检查」作为一次性 compute 交给 useStartupNotification 基座，自身不负责排程。'''),
    (16, 'after', '''// 同步跑安装检查；configSaveFailed / installed / skipped(unknown) 三类结果各自 push 一条右下角通知（基座统一控制展示与超时）。'''),
]
