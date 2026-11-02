ANNOTATIONS = [
    (1, 'before', """模块总述：推断当前运行所使用的 API provider（一手 Anthropic / Bedrock / Vertex / Foundry），并提供一手 Anthropic base URL 的校验。"""),
    (4, 'after', """APIProvider 联合类型：四类 provider 的枚举值，决定后续走哪条请求链路。"""),
    (6, 'before', """getAPIProvider：按 bedrock → vertex → foundry 的优先级，用环境变量逐一判定，均不满足时回退一手 Anthropic。"""),
    (16, 'before', """getAPIProviderForStatsig：把 provider 结果 cast 成 Statsig 上报所需的遥测元数据类型，仅做类型桥接。"""),
    (25, 'before', """isFirstPartyAnthropicBaseUrl：未设置 `ANTHROPIC_BASE_URL`（默认一手）或指向 `api.anthropic.com`（内网用户额外含 `api-staging`）时视为一手地址。"""),
    (37, 'after', """catch 兜底：URL 解析异常（格式非法等）一律按非一手地址返回 false，避免漏判。"""),
]
