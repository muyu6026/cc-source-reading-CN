# -*- coding: utf-8 -*-
# LSPTool/symbolContext.ts 批注数据
ANNOTATIONS = [
    (6, 'after', '''64KB 读窗：hover/goto 的目标多在最近编辑附近，64KB 约覆盖 1000 行典型代码——为渲染一行摘要去读整个文件不划算。'''),
    (20, 'after', '''同步 I/O 是被迫的：调用方 renderToolUseMessage 是同步 React 渲染函数，无法 await。eslint disable 注释点明这是有意的例外；任何读失败都返回 null 让 UI 退回 position 显示。'''),
    (48, 'after', '''读窗截断的哨兵判断：正好填满 64KB 说明文件还没读完，最后一行可能是半行——请求半行里的符号宁可放弃（返回 null），也不给错误答案。'''),
    (62, 'after', '''正则刻意宽松：标识符之外还吃 Rust 生命周期（前导单引号）、宏（结尾叹号）和运算符串——这个函数服务多语言，宁滥勿缺。'''),
]
