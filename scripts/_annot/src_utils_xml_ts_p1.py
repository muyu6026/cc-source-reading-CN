# source: src/utils/xml.ts
ANNOTATIONS = [
    (1, 'before', '''提供两份 XML/HTML 转义函数，用于在标签之间的文本内容、或属性值里，安全地插值不可信字符串（进程标准输出、用户输入、外部数据）。'''),
    (8, 'after', '''escapeXml：把 &、<、> 三个字符转成对应实体，适用于标签之间的文本内容插值。'''),
    (16, 'after', '''escapeXmlAttr：在 escapeXml 的基础上再转义双引号与单引号（&quot;、&apos;），适用于被双引号或单引号包裹的属性值插值。'''),
]
