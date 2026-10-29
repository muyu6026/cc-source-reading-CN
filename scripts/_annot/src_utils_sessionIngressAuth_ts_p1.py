# 数据文件：src/utils/sessionIngressAuth.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/sessionIngressAuth.ts'

ANNOTATIONS = [
    (12, 'after', '导入会话入口令牌的存储与读取工具：全局态、已知文件路径描述符、调试日志、错误处理与文件系统实现。'),
    (86, 'after', 'getTokenFromFileDescriptor：优先读全局态缓存；无 FD 环境变量时退回已知文件；有 FD 则按平台选 /dev/fd 或 /proc/self/fd 读取，失败再退回文件。'),
    (110, 'after', 'getSessionIngressAuthToken：优先级为环境变量 > 文件描述符（含文件兜底），与文档约定的三路回退一致。'),
    (131, 'after', 'getSessionIngressAuthHeaders：依据令牌类型拼认证头——会话密钥用 Cookie + 组织 UUID，JWT 用 Bearer。'),
    (140, 'after', 'updateSessionIngressAuthToken：直接在进程内改写环境变量来刷新令牌，供 REPL 桥在重连后注入新令牌而无需重启。'),
]
