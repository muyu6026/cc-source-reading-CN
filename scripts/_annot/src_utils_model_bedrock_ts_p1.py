# 批注数据：source/src/utils/model/bedrock.ts（第 66 批）
# 锚点：行号, 位置(before/after/after_block), 中文批注（自带「注：」前缀，禁止 " 与 \）
ANNOTATIONS = [
    (1, 'before', """注：本文件封装 AWS Bedrock 相关逻辑：列出可用推理配置、构建 Bedrock 客户端、从 ARN 抽取模型名与跨区前缀，并支持给模型 ID 加/换区域前缀。"""),
    (7, 'before', """注：getBedrockInferenceProfiles 分页拉取系统定义的推理配置，过滤出 Anthropic 相关的，返回其 ID 列表。"""),
    (43, 'before', """注：findFirstMatch 在配置列表中找第一个包含某子串的 ID，用于按模型名定位配置。"""),
    (50, 'before', """注：createBedrockClient 按环境变量决定区域与端点，默认从 AWS 区域环境变量读取；可跳过鉴权走 noAuth 方案，否则用刷新后的凭证。"""),
    (96, 'before', """注：createBedrockRuntimeClient 与上一个类似，但构建运行时客户端；BedrockRuntimeClient 默认 HTTP/2，代理场景会强制回退 HTTP/1.1。"""),
    (141, 'before', """注：getInferenceProfileBackingModel 取某推理配置背后的实际基础模型 ARN，返回其模型名（用于成本核算），出错时返回 null。"""),
    (181, 'before', """注：isFoundationModel 判断模型 ID 是否为基础模型，约定以 anthropic. 前缀标识。"""),
    (189, 'before', """注：BEDROCK_REGION_PREFIXES 列出跨区推理的四种前缀：us/eu/apac/global。"""),
    (199, 'before', """注：extractModelIdFromArn 从完整 ARN 里抠出末尾的模型或推理配置 ID；若输入本就不是 ARN 则原样返回。"""),
    (222, 'before', """注：getBedrockRegionPrefix 在 ARN 或纯 ID 上识别跨区前缀；基础模型或第一方格式无此前缀时返回 undefined。"""),
    (248, 'before', """注：applyBedrockRegionPrefix 给模型 ID 加或换区域前缀：已有不同前缀则替换，是基础模型则补前缀，非 Bedrock 格式则原样返回。"""),
]
