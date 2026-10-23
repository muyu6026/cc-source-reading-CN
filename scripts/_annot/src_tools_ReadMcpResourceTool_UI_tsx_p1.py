ANNOTATIONS = [
    (10, 'before', '''renderToolUseMessage：uri 或 server 缺失时返回 null——半截输入不渲染，避免出现 Read resource "undefined" 这种噪音行。'''),
    (16, 'before', '''userFacingName 导出为函数供主工具文件引用（主文件里是 import 后直接挂到 buildTool 上）。'''),
    (19, 'before', '''renderToolResultMessage：空 contents 一行置灰；有内容 JSON 美化后走 OutputLine。'''),
    (24, 'before', '''空内容分支。'''),
    (34, 'after', '''同样带 no-restricted-syntax 豁免——给人看的 UI 不守 tool_result 的序列化规则。'''),
]
