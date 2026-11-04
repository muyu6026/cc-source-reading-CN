# -*- coding: utf-8 -*-
# annotations for src/components/Spinner/utils.ts (85 lines)
ANNOTATIONS = [
    (4, 'before', 'getDefaultCharacters：spinner 的六帧字符表，按终端类型与平台分叉'),
    (6, 'after', 'Ghostty 终端把最后一帧 ✽ 换成星号：注释说明 ✽ 在该终端渲染有轻微偏移'),
    (8, 'after', 'darwin 与非 darwin 只差第三帧（✳ 与 *）：macOS 能正常渲染 ✳，其他平台换成星号保底'),
    (14, 'before', 'interpolateColor：两色按 t 线性插值，逐通道四舍五入'),
    (27, 'before', 'toRGBColor：转成 rgb(r,g,b) 字符串给 Text 的 color 用'),
    (32, 'before', 'hueToRgb：HSL 转 RGB，固定饱和度 0.7 与亮度 0.6（语音模式波形的配色参数）'),
    (33, 'after', 'hue 先归一化到 0 到 360：负数与超过一圈的值都能正确落位'),
    (36, 'after', '标准 HSL 到 RGB 六段式：c 是色度、x 是次色、m 是亮度偏移'),
    (68, 'before', 'RGB_CACHE 模块级缓存：解析结果按原始字符串缓存，命中直接返回'),
    (72, 'after', '用 !== undefined 判断命中而非真值判断：null 也是有效缓存值——解析失败的结果同样被记住，不重复跑正则'),
]
