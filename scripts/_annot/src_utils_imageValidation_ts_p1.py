ANNOTATIONS = [
    (11, 'after', '''OversizedImage 类型：记录超限图的索引与大小。'''),
    (35, 'after', '''ImageSizeError 收尾：单图与多图两种报错文案，提示先缩放再发送。'''),
    (49, 'after', '''isBase64ImageBlock 收尾：类型守卫，判断块是否为 base64 图像块。'''),
    (104, 'after', '''validateImagesForAPI 收尾：API 边界安全网，仅查 user 消息，按 base64 串长判超限，超限抛 ImageSizeError。'''),
]
