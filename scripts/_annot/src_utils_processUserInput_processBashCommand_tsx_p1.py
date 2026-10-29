# 数据文件：src/utils/processUserInput/processBashCommand.tsx
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/processUserInput/processBashCommand.tsx'

ANNOTATIONS = [
    (20, 'after', 'processBashCommand：把用户在输入框敲的 bash 命令封装成标准消息并真正执行，返回要追加的消息与是否继续查询。'),
    (35, 'after', '把输入命令包成 <bash-input> 标签写入用户消息，再交给后续流程统一消费。'),
    (44, 'after', '先展示初始进度 UI（BashModeProgress），让用户立即看到命令已接收。'),
    (66, 'after', '统一的进度回调：两种 shell 后端都吐 ShellProgress，共用同一套进度刷新逻辑。'),
    (88, 'after', '按是否启用 PowerShell 选择工具并调用；用户用 ! 开头的命令在沙箱外执行，dangerouslyDisableSandbox 在此生效。'),
    (101, 'after', '复用与内联 !cmd、模型发起 Bash 相同的格式化管线，把大输出落盘后包成 <persisted-output>。'),
    (112, 'after', '成功时把 stdout/stderr 分别包进 <bash-stdout>/<bash-stderr> 标签返回，不触发后续查询。'),
    (135, 'after', '异常分支：ShellError 按是否被中断分别返回打断消息或 stderr；其它错误统一包成 <bash-stderr>。'),
    (139, 'after', 'finally 中清空进度 UI；整个函数确保无论成功失败都清理掉临时渲染状态。'),
]
