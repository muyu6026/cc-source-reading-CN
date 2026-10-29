# 数据文件：src/utils/http.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/http.ts'

ANNOTATIONS = [
    (14, 'after', 'HTTP 相关常量与辅助函数：构造各类请求的 User-Agent 与认证头。'),
    (35, 'after', 'getUserAgent：拼 CLI 的 User-Agent，附带 SDK 版本、客户端应用与按负载/进程划分的 workload 标签（用于可观测与 QoS 路由）。'),
    (50, 'after', 'getMCPUserAgent：MCP 场景的 User-Agent，仅在有对应环境变量时追加标识。'),
    (58, 'after', 'getWebFetchUserAgent：访问任意站点的 WebFetch 用 Anthropic 公开文档的 Claude-User 标识，便于站点区分本地 CLI 与云端抓取。'),
    (63, 'after', 'AuthHeaders：返回认证头集合，失败时带 error 说明。'),
    (99, 'after', 'getAuthHeaders：Max/Pro 订阅用户走 OAuth 头，普通用户走 x-api-key；任一种缺失令牌都返回空头加错误说明。'),
    (136, 'after', 'withOAuth401Retry：封装一次「遇 401（或指定 403 吊销）先强制刷新 OAuth 令牌并重试」的包装，应对本地过期判断与服务端不一致。'),
]
