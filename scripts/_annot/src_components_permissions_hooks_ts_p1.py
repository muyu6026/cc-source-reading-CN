# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (26, 'before', '''UnaryEvent：单态事件的结构（完成类型 + 语言名）。'''),
    (31, 'before', '''permissionResultToLog：把权限判定结果序列化成可读日志字符串。'''),
    (61, 'before', '''decisionReasonToString：把判定原因（规则/模式/分类器等）转成文本。'''),
    (101, 'before', '''usePermissionRequestLogging：用分析与单态日志上报权限请求事件。'''),
    (114, 'before', '''用 ref 记录已记录的 toolUseID，避免同一弹窗内重复上报。'''),
    (123, 'before', '''递增权限提示计数，用于归因追踪。'''),
    (132, 'before', '''上报分析事件：工具名、是否 MCP、判定原因类型、沙箱开关。'''),
    (142, 'before', '''内部环境专属：无「始终允许」规则时上报缺失建议的事件。'''),
    (167, 'before', '''内部环境专属：拆解 bash 命令行并上报，用于归并应被允许却询问的调用。'''),
    (199, 'after', '''依赖变更时重新执行上报逻辑。'''),
]
