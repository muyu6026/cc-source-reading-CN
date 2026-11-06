# -*- coding: utf-8 -*-
# 第 167 批：src/commands/export/export.tsx 批注数据（编译器产物）
ANNOTATIONS = [
    (1, 'after', '''依赖：path.join、React、导出对话框组件、命令与消息类型、cwd 与纯文本渲染、废弃的同步写文件。'''),
    (9, 'after', '''最后一条 import；下面都是辅助函数与命令入口。'''),
    (18, 'after', '''formatTimestamp：把 Date 拼成年月日时分秒的文件名安全串。'''),
    (41, 'after', '''extractFirstPrompt：取第一条用户消息的首行、截到五十字，作为默认文件名。'''),
    (48, 'after', '''sanitizeFilename：小写化、去特殊字符、空格与多余连字符归一，做文件名清洗。'''),
    (52, 'after', '''exportWithReactRenderer：用 React 渲染器把消息转成纯文本。'''),
    (53, 'after', '''call 命令入口：先渲染对话内容，再决定写文件还是弹对话框。'''),
    (68, 'after', '''直接写盘分支：带了参数就同步写出点 txt，成功或失败都回显给用户。'''),
    (84, 'after', '''默认文件名：有首提示就清洗后拼接时间戳，否则用 conversation-时间戳。'''),
    (90, 'after', '''无参数时返回导出对话框组件，让用户决定文件名与落盘位置。'''),
]
