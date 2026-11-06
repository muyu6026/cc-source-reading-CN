# -*- coding: utf-8 -*-
# 第 166 批：src/types/generated/events_mono/common/v1/auth.ts 批注数据
ANNOTATIONS = [
    (7, 'before', '''eslint 禁用指令：生成代码无需遵循本仓库 lint 规则。'''),
    (10, 'before', '''公共 API 鉴权上下文接口，由网关自动注入。'''),
    (11, 'after', '''账户 ID、组织 UUID、账户 UUID 均为可选字段。'''),
    (16, 'before', '''构造默认值工厂，便于 create/fromPartial 复用。'''),
    (20, 'before', '''PublicApiAuth 的消息函数集（序列化/反序列化）。'''),
    (21, 'after', '''fromJSON：把任意 JSON 还原为强类型对象。'''),
    (35, 'after', '''toJSON：序列化为纯对象，数值取整。'''),
    (49, 'after', '''create：基于默认值与部分字段创建实例。'''),
    (54, 'after', '''fromPartial：深度合并默认值与传入部分对象。'''),
    (65, 'before', '''Builtin：TS 内建类型集合，作为递归 Partial 的终止条件。'''),
    (74, 'before', '''DeepPartial：递归地把所有子字段变为可选。'''),
    (84, 'after', '''KeysOfUnion：取联合类型的全部键。'''),
    (85, 'after', '''Exact：约束传入类型不得多出未知键。'''),
    (91, 'before', '''isSet：非空且非 undefined 判断。'''),
]
