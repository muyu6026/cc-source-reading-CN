# -*- coding: utf-8 -*-
# PowerShellTool/toolName.ts 批注数据
ANNOTATIONS = [
    (1, 'after', '''独立两行文件只为打破循环依赖：prompt.ts 要引用工具名常量，而工具名不能反向 import prompt（那里有函数体）。'''),
]
