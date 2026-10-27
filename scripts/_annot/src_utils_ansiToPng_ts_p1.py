ANNOTATIONS = [
    (28, 'after', '''把 ANSI 转义终端文本直接栅格化为 PNG：跳过 SVG 中间层，用内嵌位图字形写入 RGBA 缓冲，再以 node:zlib 编码 PNG，零外部依赖且跨平台一致。'''),
    (56, 'after', '''makeFallbackGlyph：为位图字体未覆盖的码位生成虚线框兜底字形。'''),
    (72, 'after', '''decodeFont：解码内嵌 base64 位图字体，格式为计数加若干「码位+alpha 字节」条目。'''),
    (153, 'after', '''ansiToPng 主函数：解析 ANSI、裁掉尾部空行、计算画布尺寸、填充背景与圆角、逐字栅格化，最后编码 PNG。'''),
    (205, 'after', '''blitGlyph：把单个字形按最近邻缩放写入 RGBA 缓冲并做 alpha 合成；粗体通过提升 alpha 近似更重的笔划。'''),
    (265, 'after', '''roundCorners：把四角四分之一圆外的 alpha 清零，形成圆角矩形效果。'''),
    (334, 'after', '''encodePng：最小 PNG 编码器，8 位 RGBA、filter 0、单 IDAT，使用 deflate 压缩。'''),
]
