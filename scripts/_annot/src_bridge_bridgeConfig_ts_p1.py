# 批注数据：source/src/bridge/bridgeConfig.ts
# slug: src_bridge_bridgeConfig_ts

ANNOTATIONS = [
    (1, 'after', '文件头注释：集中管理 bridge 鉴权与 URL 解析，消除十余处重复的蚂蚁内部环境变量覆盖。'),
    (14, 'after', '引入 OAuth 配置与令牌读取工具。'),
    (18, 'after', '蚂蚁内部开发覆盖：仅当 USER_TYPE 为 ant 且设了 CLAUDE_BRIDGE_OAUTH_TOKEN 时返回该值，否则 undefined。'),
    (27, 'after', '蚂蚁内部开发覆盖：返回 CLAUDE_BRIDGE_BASE_URL 或 undefined。'),
    (34, 'after', '注释：bridge API 访问令牌的解析优先级——开发覆盖优先，否则回退到 OAuth 钥匙串。'),
    (38, 'after', '导出访问令牌解析函数：undefined 表示未登录。'),
    (39, 'after', '令牌解析：覆盖值优先，缺失时回退到 OAuth 钥匙串的访问令牌。'),
    (42, 'after', '注释：bridge API base URL 的解析优先级——开发覆盖优先，否则用生产 OAuth 配置，始终返回有效 URL。'),
    (46, 'after', '导出 base URL 解析函数。'),
    (47, 'after', '优先用开发覆盖，否则回退到生产 OAuth 配置。'),
]
