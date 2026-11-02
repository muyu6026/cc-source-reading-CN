ANNOTATIONS = [
    (1, 'before', '''文件级批注：`embeddedTools.ts` 负责判断当前构建是否内嵌了搜索工具（bfs/ugrep），以及返回内嵌搜索工具的 bun 二进制路径，仅用于 ant-native 构建。'''),
    (21, 'after', '''第一个函数收尾：检测是否内嵌搜索工具——先读 `EMBEDDED_SEARCH_TOOLS` 环境变量，再排除 sdk 类入口点，本地 agent 等场景才启用。'''),
    (29, 'after', '''第二个函数收尾：直接返回当前进程可执行路径（`process.execPath`），即承载内嵌 bfs/ugrep 的 bun 二进制。'''),
]
