# -*- coding: utf-8 -*-
# PowerShellTool/UI.tsx 批注数据
ANNOTATIONS = [
    (18, 'after', '''非交互模式命令显示双限：2 行加 160 字符，超限截断加省略号——长命令不必整段刷屏。'''),
    (49, 'after', '''verbose 直接全文返回，多行命令不做行数截断。'''),
    (71, 'after', '''进度复用 ShellProgressMessage——与 BashTool 同一套组件（全输出、行数、字节数、超时、后台任务 ID）。'''),
    (103, 'after', '''图像结果不回显——数据已直接发给模型，终端只显示一行说明。'''),
    (129, 'after', '''空输出的三分支占位：后台任务提示（下箭头键管理）、Interrupted、退出码解释或 No output——退出码解释文案来自 commandSemantics 的 interpretCommandResult。错误渲染退到 Fallback 组件，没有定制折叠。'''),
]
