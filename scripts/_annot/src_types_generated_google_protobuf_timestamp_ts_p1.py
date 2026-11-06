# -*- coding: utf-8 -*-
"""src/types/generated/google/protobuf/timestamp.ts 批注数据（第 161 批）。"""

ANNOTATIONS = [
    (100, 'before', '''Timestamp 接口：只暴露秒与纳秒两个可选字段，编码自 Unix 纪元'''),
    (106, 'before', '''seconds：自 Unix 纪元起的秒数，范围限定在公元元年到九千九百九十九年'''),
    (113, 'before', '''nanos：纳秒级的非负小数部分，范围零到九亿九千九百九十九'''),
    (116, 'before', '''构造起点：秒与纳秒都初始化为零'''),
    (120, 'before', '''Timestamp 的运行时对象：fromJSON、toJSON、create、fromPartial 四件套'''),
    (128, 'before', '''toJSON 把秒与纳秒各自四舍五入回整数，符合 proto3 JSON 约定'''),
    (139, 'before', '''create 与 fromPartial：基于深拷贝的偏量构造，缺省字段补零'''),
    (152, 'before', '''Builtin 列出所有无需递归展开的基础类型'''),
    (161, 'before', '''DeepPartial：把每个字段递归变成可选，数组与对象分别处理'''),
    (171, 'before', '''KeysOfUnion：取出联合类型里每个成员的键的并集'''),
    (172, 'before', '''Exact：约束传入类型与模板完全一致，多出的键被标成 never 以报错'''),
    (178, 'before', '''isSet：非空即视为已设置，用于 JSON 解析时区分缺省与零值'''),
    (182, 'before', '''MessageFns 接口：规定所有消息类型都必须实现这四件方法'''),
]
