# -*- coding: utf-8 -*-
"""commands/copy/copy.tsx 批注数据（/copy 命令，React 编译器产物）。"""

ANNOTATIONS = [
    (1, 'before', '/copy 命令：把最近一条助手消息（或其中某个代码块）复制到剪贴板，并同时写一份临时文件作为兜底；可交互挑选要复制的内容'),
    (23, 'before', '三个常量：临时目录、响应文件名、最多回看多少条消息'),
    (26, 'before', 'CodeBlock：抽取出的代码块 = 代码 + 语言'),
    (30, 'before', 'extractCodeBlocks：用 marked 解析 markdown，取出所有代码块'),
    (50, 'before', 'collectRecentAssistantTexts：从新到旧收集助手消息正文，跳过纯工具调用与 API 错误，最多回看 MAX_LOOKBACK 条'),
    (62, 'before', 'fileExtension：把语言标识净化成扩展名，防路径穿越（如 ../../etc/passwd）'),
    (73, 'before', 'writeToFile：把文本写进临时目录下的文件'),
    (81, 'before', 'copyOrWriteToFile：先试剪贴板，再写临时文件兜底，返回描述性结果'),
    (95, 'before', 'truncateLine：按显示宽度截断第一行，超长加省略号'),
    (111, 'before', 'PickerProps：选择器的入参'),
    (119, 'before', 'PickerSelection：可选整条、某个代码块、或「以后都复制整条」'),
    (120, 'before', 'CopyPicker：交互组件，渲染选项列表并处理选择 / 写入文件 / 快捷键'),
    (334, 'before', 'call：命令入口，先取最近助手文本，无参数取最新、带 N 取第 N 条；无代码块或已设全量复制则直接复制，否则弹选择器'),
    (342, 'before', '解析参数 N：N 为 1 表示最新，越界或非法给用法提示'),
    (356, 'before', '取出目标消息与它的代码块'),
    (357, 'before', '若没有任何代码块，或配置里已设「总是复制整条」，就直接复制整条消息'),
    (359, 'before', '否则弹出选择器，让用户挑整条还是某个代码块'),
]
