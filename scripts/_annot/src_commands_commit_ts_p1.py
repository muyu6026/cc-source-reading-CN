# -*- coding: utf-8 -*-
# 第 167 批：src/commands/commit.ts 批注数据
ANNOTATIONS = [
    (1, 'after', '''依赖：命令类型、归属文案、把提示词里的 shell 指令真正跑起来的执行器、隐身模式开关。'''),
    (6, 'after', '''白名单：只允许 git add / status / commit 三条，提交命令的权限收得很死。'''),
    (20, 'after', '''getPromptContent：拼出一段给模型的提交提示词，含 git 状态、diff、分支、近期提交。'''),
    (34, 'after', '''git 安全协议：明文禁止改配置、跳 hook、amend、提交疑似密钥文件、空提交、交互式命令。'''),
    (55, 'after', '''提示词收尾：要求用 HEREDOC 写提交信息，并强调只做这一件事、不夹带其它工具调用。'''),
    (57, 'after', '''命令对象：type 为 prompt，内置命令，进度文案 creating commit。'''),
    (62, 'after', '''contentLength 为 0：内容由 getPromptForCommand 动态生成，这里只是占位。'''),
    (89, 'after', '''getPromptForCommand：把提示词里的感叹号反引号指令执行掉，再注入 alwaysAllow 规则放行白名单。'''),
    (90, 'after', '''satisfies Command：用类型谓词保证这个对象形状完全符合 Command 契约。'''),
    (92, 'after', '''默认导出：其它地方 import 这个 command 即可挂到 /commit。'''),
]
