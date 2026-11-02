# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件导出 semanticNumber：一个对「字符串形式的数字字面量」做宽容解析的 zod 预处理包装，用于容错模型偶尔把数字加引号的情况。'''),
    (3, 'before', '''模块注释详述动机：模型生成的 JSON 偶尔会把数字加引号（如 `head_limit` 取值为字符串），z.number() 会直接报类型错误；而 z.coerce.number() 又会吞掉空串或 null 这类真实 bug，故仅对合法的十进制字面量做转换。'''),
    (26, 'before', '''semanticNumber：以 z.preprocess 包裹内层 schema。仅当入参是字符串且匹配十进制数字字面量（允许负号与小数）时才尝试转数字；其余情况原样透传，交给内层 schema 拒绝。可选与默认值必须挂在内层。'''),
]
