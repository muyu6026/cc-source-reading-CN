# 数据文件：src/utils/textHighlighting.ts
SOURCE_PATH = 'src/utils/textHighlighting.ts'
ANNOTATIONS = [
    (9, 'after', """文件入口：把高亮区间叠加到含 ANSI 转义的文本上，输出可分段渲染的字符串。"""),
    (19, 'after', """TextHighlight：高亮区间的起止位置、颜色、优先级等。"""),
    (25, 'after', """TextSegment：一段带可选高亮的文本。"""),
    (57, 'after', """跳过与已用区间重叠的高亮，去重避免重复着色。"""),
    (60, 'after', """segmentTextByHighlights：按优先级排序并去重后分段。"""),
    (70, 'after', """双坐标系分别追踪用户可见位置与含 ANSI 转义的原始字符串位置。"""),
    (74, 'after', """HighlightSegmenter 构造器：分词并建立双坐标系。"""),
    (94, 'after', """segment：依次生成高亮前、高亮中、高亮后三段。"""),
    (161, 'after', """segmentTo：消费 token 直到目标可见位置，返回带 ANSI 前后缀的文本段。"""),
    (166, 'after', """reduceCodes：化简 ANSI 码并丢弃结束码。"""),
]
