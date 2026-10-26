# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (13, 'after', '''// 解析主循环使用的模型名：优先 session 覆盖，其次全局设置，最后默认值。'''),
    (25, 'after', '''// 订阅 GB 刷新信号强制重渲染：GB 初始化完成后 AppState 不变，但别名解析需重算（否则 /model 显示与实际采样不一致）。'''),
    (33, 'after', '''// parseUserSpecifiedModel 经 _CACHED_MAY_BE_STALE 读 ant 模型覆盖；GB 刷新前是磁盘缓存，刷新后是远程 map。'''),
]
