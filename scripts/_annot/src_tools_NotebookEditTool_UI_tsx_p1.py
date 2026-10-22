# -*- coding: utf-8 -*-
"""NotebookEditTool/UI.tsx 第 1 部分"""

ANNOTATIONS = [
    (21, 'after', '''getToolUseSummary：返回显示路径（绝对路径缩略为 ~/… 形式），供活动流/摘要用。'''),
    (47, 'after', '''renderToolUseMessage：verbose 模式给全路径 + 单元格 id + 内容前 30 字符 + 类型/模式；
紧凑模式只留「路径@单元格」。字段缺失返回 null（让上层用兜底渲染）。'''),
    (59, 'after', '''拒绝消息整块委托给共享组件 NotebookEditToolUseRejectedMessage
（与 FileEditTool 的拒绝 UI 同一体系）。'''),
    (71, 'after', '''错误渲染：非 verbose 且内容带 tool_use_error 标签时只显示一句「Error editing notebook」；
否则交给 FallbackToolUseErrorMessage 展示完整错误。'''),
    (92, 'after', '''结果渲染：成功时显示「Updated cell <id>」+ 新 source 的语法高亮
（filePath 伪装成 notebook.py 以触发 Python 高亮）；失败直接红字 error。'''),
]
