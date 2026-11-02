# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件导出 semanticBoolean：一个对「字符串形式的布尔字面量」做宽容解析的 zod 预处理包装，用于容错模型偶尔把布尔加引号的情况。'''),
    (3, 'before', '''模块注释详述动机：模型生成的 JSON 偶尔会把布尔加引号（如 `replace_all` 取值为字符串），z.boolean() 会报类型错误；而 z.coerce.boolean() 用 JS 真值判断会把 `false` 解析成 true，故只对字面量 true / false 做精确转换。'''),
    (22, 'before', '''semanticBoolean：以 z.preprocess 包裹内层 schema。仅当入参严格等于字符串 true / false 时才转换，其余情况原样透传交给内层 schema；可选与默认值必须挂在内层。'''),
]
