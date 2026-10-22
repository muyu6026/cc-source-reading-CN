# -*- coding: utf-8 -*-
# LSPTool/formatters.ts 批注数据
ANNOTATIONS = [
    (23, 'after', '''formatUri 是所有格式化器的公共出口：剥 file:// 协议、修 Windows 盘符斜杠、URI 解码容错、转相对路径。转相对路径有双条件：必须更短、且不能以多级向上（三个点以上）开头——跨目录的相对引用反而更难读。'''),
    (34, 'after', '''undefined URI 说明 LSP 服务器返回了畸形数据——格式化层兜底显示占位符而不是崩掉，同时 warn 日志留痕。这一层的防御性检查是「应该更早被拦」的第三道保险。'''),
    (94, 'after', '''groupByFile 用「有没有 uri 字段」同时吃 Location[] 与 SymbolInformation[] 两种形态——泛型加 in 判别，不需要继承体系。'''),
    (121, 'after', '''与 LSPTool.ts 里同名的 isLocationLink 在此重复定义——格式化层与工具层各自独立做判别，不共享。本地五行的复制比跨模块耦合便宜。'''),
    (133, 'after', '''所有「空结果」消息都解释可能原因（光标不在符号上、外部库未被索引）——模型拿到这种消息能自行决定换位置重试，而不是当成工具故障上报。'''),
    (217, 'after', '''多文件引用按文件分组渲染：文件名一行、行号缩进列表——避免同文件路径重复刷屏，模型按文件跳转也更自然。'''),
    (244, 'after', '''hover 内容有三种形态：字符串数组、纯字符串、MarkupContent 或 MarkedString 对象——LSP 规范的历史包袱，extractMarkupText 一一拆包后拼接。'''),
    (302, 'after', '''26 种 SymbolKind 手工映射成可读名——LSP 用数字枚举，直出数字对模型毫无信息量。'''),
    (356, 'after', '''documentSymbol 若返回扁平格式，直接复用 workspaceSymbol 的格式化器——同一种数据形态只写一份渲染逻辑。'''),
    (448, 'after', '''CallHierarchyItem 的 URI 也要校验——畸形数据下显示名字与类型、位置用占位符，不丢整条记录。'''),
    (525, 'after', '''fromRanges 显示调用点坐标——「谁调用了它」之外还给「在哪里调用」，模型能直接跳到调用现场。incoming 用 calls at、outgoing 用 called from，方向措辞跟着语义走。'''),
]
