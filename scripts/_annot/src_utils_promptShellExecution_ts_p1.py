# 数据文件：src/utils/promptShellExecution.ts

ANNOTATIONS = [
    (18, 'after', '''文件级：解析提示词文本里内嵌的 shell 命令（代码块 ```! 与内联 !`），按 frontmatter 选择 bash 或 powershell 路由执行，并把输出回填到文本。'''),
    (25, 'after', '''PromptShellTool：BashTool 与 PowerShellTool 都满足的窄结构切片，call 只接 {command} 与 context，返回 {data: ShellOut}。'''),
    (46, 'after', '''getPowerShellTool：懒加载 PowerShellTool，避免在启动导入链上提前加载 parser / 校验器；仅在首个 shell: powershell 的技能真正运行时才 require。'''),
    (56, 'after', '''两个匹配模式：代码块用 ```! 围栏，内联用 !`...`；内联用 lookbehind 要求 ! 前是空白或行首，避免误匹配 markdown 行内代码与 shell 变量。'''),
    (83, 'after', '''解析工具一次：shell 为 undefined 与 bash 都走 BashTool，仅当运行时门控放行 powershell 才切到 PowerShellTool（技能作者的 frontmatter 选择不能覆盖用户开关）。'''),
    (90, 'after', '''性能门控：内联模式的正则比代码块慢约 100 倍，93% 的技能根本不含 !`，故先用廉价子串判断再决定是否做昂贵扫描。'''),
    (131, 'after', '''用函数式替换器而非裸字符串，避免 shell 输出里的 $、$$、$` 等被 String.replace 误解释。'''),
    (143, 'after', '''executeShellCommandsInPrompt：扫描提示词中的 ```! 与 !` 命令，先查权限，通过后调用 shell 工具执行并用 processToolResultBlock 持久化，最后把输出回填原文本；任意命令失败即抛 MalformedCommandError。'''),
    (165, 'after', '''formatBashOutput：把 stdout / stderr 拼成回填文本，内联模式用方括号包裹 stderr。'''),
    (183, 'after', '''formatBashError：把执行异常统一包装成 MalformedCommandError；ShellError 区分中断与普通失败，其余异常取错误信息。'''),
]
