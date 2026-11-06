# -*- coding: utf-8 -*-
# 第 167 批：src/commands/memory/memory.tsx 批注数据（编译器产物）
ANNOTATIONS = [
    (1, 'after', '''依赖：fs/promises 的 mkdir/writeFile、React、命令结果类型、设计系统对话框、记忆文件选择器、ink 组件、记忆与编辑器工具。'''),
    (13, 'after', '''最后一条 import；下面 MemoryCommand 组件负责打开或新建记忆文件并拉起编辑器。'''),
    (20, 'after', '''handleSelectMemoryFile：核心回调，建目录、建文件、拉编辑器、探测编辑器变量。'''),
    (28, 'after', '''新建文件：wx 标志只在不存在时写空串，EEXIST 说明已存在就跳过保留内容。'''),
    (46, 'after', '''结果回显：打开成功就告诉用户文件位置与用的编辑器，失败就 logError 并回显错误。'''),
    (50, 'after', '''回调收尾：catch 兜底所有异常，保证命令不会无声崩溃。'''),
    (52, 'after', '''取消回调：用户取消就回显「已取消记忆编辑」。'''),
    (68, 'after', '''组件返回：把文件选择器包在 Dialog 里，底部附上记忆文档链接。'''),
    (74, 'after', '''call 入口：先清缓存再预取记忆文件，避免首开时 Suspense 闪一下 fallback。'''),
]
