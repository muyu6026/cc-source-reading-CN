ANNOTATIONS = [
    (1, 'before', '''一个 prompt.ts 装三样东西：工具名常量、DESCRIPTION（工具描述，进工具列表给模型选工具用）、PROMPT（调用时的操作手册）。'''),
    (3, 'before', '''DESCRIPTION 带 server 字段说明和两个用法示例——每个资源对象都标注来源服务器，多服务器混合罗列时模型才知道各是谁家的。'''),
    (12, 'before', '''PROMPT 与 DESCRIPTION 同构但更细：参数语义 + 不传 server 时的全量行为。'''),
    (20, 'after', '''模板字符串收尾。'''),
]
