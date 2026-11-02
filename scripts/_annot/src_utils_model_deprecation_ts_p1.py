# 批注数据：src/utils/model/deprecation.ts
ANNOTATIONS = [
    (9, 'after', '''定义单个已弃用模型的详情类型：标记 isDeprecated 为真、记录模型名与下线日期。'''),
    (19, 'after', '''联合类型：已弃用与未弃用两种结果，调用方用 isDeprecated 字段区分。'''),
    (33, 'after', '''集中登记已弃用模型及其各 provider 的下线日期（null 表示该 provider 未弃用）。新增弃用模型只需在此加一项。'''),
    (66, 'after', '''按模型 ID 子串匹配当前 provider 的下线日期，返回弃用信息；找不到返回未弃用。'''),
    (88, 'after', '''对外入口：拿到弃用信息后拼出带警告符号的提示语；未弃用或空 ID 返回 null。'''),
]
