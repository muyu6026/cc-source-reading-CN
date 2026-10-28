# 批注数据：source/src/utils/debug.ts（第 66 批）
# 锚点：行号, 位置(before/after/after_block), 中文批注（自带「注：」前缀，禁止 " 与 \）
ANNOTATIONS = [
    (1, 'before', """注：本文件实现调试日志系统：按级别过滤、按命令行开关或环境变量决定是否开启，支持写入文件（含最新日志符号链接）或直接写标准错误。"""),
    (18, 'after', """注：DebugLogLevel 定义从最啰嗦到最严重的五级：verbose/debug/info/warn/error，LEVEL_ORDER 给出它们的数值顺序。"""),
    (34, 'before', """注：getMinDebugLogLevel 从环境变量读最低输出级别，默认 debug（即过滤掉 verbose 噪声）。"""),
    (44, 'before', """注：isDebugMode 综合多个开关判断调试是否开启：运行时标志、DEBUG/DEBUG_SDK 环境变量、命令行 --debug/-d、写文件或 --debug= 模式都算。"""),
    (64, 'before', """注：enableDebugLogging 允许会话中途开启调试（例如 /debug 命令），并清掉 isDebugMode 的缓存让其重新求值，返回此前是否已激活。"""),
    (104, 'before', """注：shouldLogDebugMessage 是写入前的守门员：测试环境、非蚂蚁内部用户未开调试、环境异常时都拒绝写日志。"""),
    (155, 'before', """注：getDebugWriter 懒创建带缓冲的写入器：调试模式下走同步立即写（避免进程退出丢日志），否则约每秒批量刷一次。"""),
    (203, 'before', """注：logForDebugging 是主写入入口：先按级别与守门员过滤，多行消息在已格式化时转成 JSON，再打时间戳写成一行 jsonl。"""),
    (230, 'before', """注：getDebugLogPath 解析调试日志落盘路径：优先用 --debug-file 指定值，其次用环境变量目录，最后回退到配置目录下的会话文件名。"""),
    (258, 'before', """注：logAntError 只对蚂蚁内部用户可见地记录错误栈，用于生产环境排障。"""),
]
