# -*- coding: utf-8 -*-
# PowerShellTool/commonParameters.ts 批注数据
ANNOTATIONS = [
    (10, 'after', '''通用参数清单（PowerShell 所有 cmdlet 经 CmdletBinding 都自带），pathValidation 与 readOnlyValidation 共用——独立成文件就是为了打破这两个大文件之间的 import 环。存储统一小写带前导横杠，调用方先把输入 toLowerCase。'''),
    (25, 'after', '''十个带值参数（-erroraction、-outvariable 等）——它们只影响错误处理与输出收集，不改变命令语义，校验时可放行。'''),
    (30, 'after', '''开关与带值参数合并成单一 Set 供快速查询。'''),
]
