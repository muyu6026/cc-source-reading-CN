# 批注数据：src/utils/streamJsonStdoutGuard.ts
# slug: src_utils_streamJsonStdoutGuard_ts
ANNOTATIONS = [
    (8, 'after', '''stream-json 标准输出守护：拦截 process.stdout.write，把非 JSON 的行改写到 stderr 并加标记，保证 SDK 客户端按 NDJSON 逐行解析时不被杂散输出打断。'''),
    (26, 'after', '''isJsonLine：判断一行是否为合法 JSON；空行在 NDJSON 流中视为合法（容忍结尾换行或空分隔）。'''),
    (49, 'after', '''installStreamJsonStdoutGuard 签名：为 --output-format=stream-json 安装运行时守护，包装 process.stdout.write 做缓冲与 JSON 校验。'''),
    (91, 'after', '''被包装的 write：把分块写入缓冲到换行符，逐行 JSON 解析；合法行转发真 stdout，非法行加标记改写 stderr，回调仍报告成功。'''),
    (109, 'after', '''registerCleanup：关闭时冲刷缓冲区中残留的半行，JSON 片段同样改写给 stderr 而非静默丢弃，并还原原始 stdout.write。'''),
    (116, 'after', '''_resetStreamJsonStdoutGuardForTesting 签名：仅供测试使用，还原真实 stdout.write 并清空缓冲，使后续测试从干净状态开始。'''),
    (123, 'after', '''_resetStreamJsonStdoutGuardForTesting 收尾：重置 installed 标记与缓冲区。'''),
]
