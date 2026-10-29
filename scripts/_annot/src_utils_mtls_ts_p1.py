# 批注数据：src/utils/mtls.ts

ANNOTATIONS = [
    (9, 'after', '''MTLSConfig 描述双向 TLS 所需的客户端证书、私钥与可选口令三个字段。'''),
    (14, 'after', '''TLSConfig 在 MTLSConfig 基础上增加可选的 CA 证书字段，覆盖单向与双向 TLS 两种场景。'''),
    (23, 'after', '''getMTLSConfig 从环境变量读取客户端证书、私钥与口令，三者任一存在才返回配置，
NODE_EXTRA_CA_CERTS 由 Node 运行时自动处理，这里不重复加载。'''),
    (44, 'after', '''读取客户端证书时用 try 包裹，失败只记日志不中断，保证其它字段仍可继续装配。'''),
    (59, 'after', '''读取客户端私钥同上，按 CLAUDE_CODE_CLIENT_KEY 指向的文件同步读入。'''),
    (65, 'after', '''口令直接取环境变量 CLAUDE_CODE_CLIENT_KEY_PASSPHRASE，无需读文件。'''),
    (74, 'after', '''getMTLSConfig 收尾：仅当至少一项配置被设置时才返回对象，否则返回 undefined。'''),
    (78, 'after', '''getMTLSAgent 在存在 mTLS 或自定义 CA 时创建带 keep-alive 的 HTTPS Agent，
把证书与 CA 合并进连接选项以提升复用性能。'''),
    (100, 'after', '''getWebSocketTLSOptions 为 WebSocket 连接返回 TLS 选项，逻辑与 Agent 版一致，
只是在调用点以不同方式装配到 WebSocket 客户端。'''),
    (117, 'after', '''getTLSFetchOptions 针对 undici 返回 TLS 配置或自定义 dispatcher，
Bun 环境直接走原生 TLS，Node 环境则惰性加载约一点五兆的 undici 包避免无谓开销。'''),
    (157, 'after', '''clearMTLSCache 清空 mTLS 配置与 Agent 两类 memoize 缓存，便于测试或配置变更后刷新。'''),
    (166, 'after', '''configureGlobalMTLS 仅在有 mTLS 配置时记录提示：NODE_EXTRA_CA_CERTS 由 Node 自动追加到内置 CA，
这里只是确认该机制生效，不做额外连接层改动。'''),
]
