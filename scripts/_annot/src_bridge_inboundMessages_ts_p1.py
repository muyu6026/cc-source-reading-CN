# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''处理来自桥接的入站用户消息：抽取内容与 UUID 并归一化图片块'''),
    (7, 'after', '''导入 SDK 消息类型与 Base64 图片格式探测工具'''),
    (21, 'after', '''extractInboundMessageFields：从桥接消息抽取可入队的内容与 uuid'''),
    (26, 'after', '''非 user 类型直接跳过'''),
    (27, 'after', '''无内容或空数组也跳过'''),
    (34, 'after', '''抽取 uuid（字符串则保留，否则 undefined）'''),
    (39, 'after', '''返回归一化后的内容（数组则规整图片块）与 uuid'''),
    (52, 'after', '''normalizeImageBlocks：规整桥接客户端发来的图片块'''),
    (55, 'after', '''无需规整时直接返回原数组引用（快乐路径零分配）'''),
    (57, 'after', '''逐块规整：补齐 media_type（camelCase→snake_case 或按内容探测）'''),
    (75, 'after', '''isMalformedBase64Image：判定图片块是否缺 media_type（会导致 API 报字段缺失）'''),
    (78, 'after', '''返回类型谓词：窄化为带 base64 源的 ImageBlockParam'''),
]
