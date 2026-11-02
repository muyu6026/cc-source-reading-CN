# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件做控制消息键名的兼容归一化：把老版本 iOS 客户端发的驼峰 requestId 改写成蛇形 request_id，否则会被 isSDKControlRequest 拒收、被 structuredIO 读成 undefined 而静默丢弃。'''),
    (13, 'before', '''normalizeControlMessageKeys：递归地把 requestId 改名成 request_id（两者都在时蛇形优先），原地修改对象；非对象或 null 直接透传。'''),
]
