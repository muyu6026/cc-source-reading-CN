# 数据文件：src/utils/deepLink/protocolHandler.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/deepLink/protocolHandler.ts'

ANNOTATIONS = [
    (24, 'after', '协议处理器模块：作为 claude --handle-uri <url> 的入口，解析深链 URI、识别终端模拟器并在新终端窗口启动 claude。'),
    (65, 'after', '始终用当前可执行文件自身（process.execPath）启动，避免 PATH 查找；同时把 FETCH_HEAD 新鲜度在跳板进程里算好再传给新实例。'),
    (75, 'after', 'handleDeepLinkUri：解析 URI、解析工作目录、在终端里拉起 claude，返回退出码（0 成功，1 失败）。'),
    (105, 'after', 'handleUrlSchemeLaunch：处理 macOS 通过 URL Scheme 直接拉起的情形，用 NAPI 接收 Apple Event 的 URL 后转交处理。'),
    (136, 'after', 'resolveCwd：解析启动 claude 的工作目录，优先级为显式 cwd > 仓库查找（MRU 克隆）> 用户主目录；本地没克隆的仓库不算错误，退回主目录。'),
]
