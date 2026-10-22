# -*- coding: utf-8 -*-
"""REPLTool/constants.ts 第 1 部分"""

ANNOTATIONS = [
    (11, 'after', '''REPL 工具名：REPL 模式下 Claude 不再直接调用底层工具，
而是通过 REPL 工具在 VM 上下文里写 JS 批量组合这些原语。'''),
    (23, 'before', '''isReplModeEnabled：REPL 模式开关判定。
内部员工（USER_TYPE=ant）交互 CLI 默认开（CLAUDE_CODE_REPL=0 可关）；遗留变量 CLAUDE_REPL_MODE=1 强制开。'''),
    (30, 'after', '''SDK 入口（sdk-ts / sdk-py / sdk-cli）不默认开：SDK 用户习惯直接脚本化调用 Bash/Read，
REPL 模式会把那些工具藏起来。USER_TYPE 是构建期 --define 常量，若不看 ENTRYPOINT，
ant 原生二进制会强制每个 SDK 子进程都开 REPL——所以这里要求 entrypoint 必须是 cli。'''),
    (37, 'before', '''REPL_ONLY_TOOLS：REPL 模式开启后对模型隐藏、只能进 REPL VM 用的原语工具清单
（Read/Write/Edit/Glob/Grep/Bash/NotebookEdit/Agent）。'''),
    (46, 'after', '''清单到此为止。隐藏这些工具逼迫 Claude 用 REPL 做批量操作
（一次 VM 执行可组合多次 Read+Edit），减少工具调用轮次。'''),
]
