# -*- coding: utf-8 -*-
# src/utils/which.ts
ANNOTATIONS = [
    (1, 'before', '命令查找封装：给出命令名，返回可执行文件的绝对路径或 null。四个后端并存——异步与同步各一套，各自再按 Windows / POSIX 分叉，另有一条 Bun 原生快速路径；对外只暴露 which 与 whichSync 两个入口。'),

    (31, 'after', '异步版在 Windows 上走 where.exe，POSIX 上走 which，两者都靠 shell 执行。reject 设为 false 是为了让「命令不存在」表现为非零退出码而不是抛异常；退出码非零或输出为空一律返回 null。Windows 下 where.exe 可能返回多行，只取第一行作为结果。'),

    (56, 'after', '同步版逻辑与异步版一一对应，用弃用标记的 execSyncWrapper 执行同样两条命令，只把 stdio 收紧成三个通道分别设定并吞掉 stderr。整个体用 try.catch 包住——命令找不到时同步执行会直接抛异常，这是它和异步版的主要差异。'),

    (61, 'after', 'bunWhich 在模块加载期就做一次能力探测：只在全局存在 Bun 且其 which 是函数时才取值，否则为 null。这决定了下面两个导出符号走哪条实现，属于一次判定、全局复用。'),

    (73, 'after', 'which 的类型标注写在常量上而不是靠推断，保证 Bun 分支与 Node 分支签名完全一致。三元表达式在模块加载期只求值一次，运行期不再重复判断环境。'),

    (82, 'after', 'whichSync 用空值合并而不是三元：bunWhich 存在就直接用，否则退到同步实现。注意此处不区分同步异步——Bun.which 本身是同步函数，正好同时满足两个入口的语义。'),
]
