# -*- coding: utf-8 -*-
# LSPTool/UI.tsx 批注数据
ANNOTATIONS = [
    (56, 'after', '''九种操作的标签表：单复数加 special 字段。hover 用 available 替代数字计数——「Hover info available」比「Found 1 hover info」自然。'''),
    (82, 'after', '''resultCount 为 1 用单数——英文界面里数量词必须跟数走。'''),
    (85, 'after', '''hover 有结果时整个主文案换成 Hover info available，不走 Found N 模板——计数值对 hover 没有意义。'''),
    (139, 'after', '''verbose 展开完整内容（缩进排版），非 verbose 折叠成一行摘要加 Ctrl+O 展开提示——与 Bash 系工具同款折叠协议。'''),
    (189, 'after', '''位置类操作在 header 里显示光标处的符号名（getSymbolAtPosition 同步提取）——「hover: "foo" in "bar.ts"」比裸坐标可读得多；提取失败退回 position 显示。'''),
    (199, 'after', '''documentSymbol/workspaceSymbol 只显示操作与文件——没有「光标处符号」概念，坐标列出来也是噪音。'''),
    (209, 'after', '''非交互模式下错误折叠成一行红字；verbose 才给完整错误内容——错误详情主要给调试，日常把注意力留给结果。'''),
    (220, 'after', '''有计数走折叠摘要；没有（服务器初始化失败、请求异常等错误路径）直接输出原文——错误文本不值得做摘要。'''),
]
