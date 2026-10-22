# 批注数据：source/src/services/tokenEstimation.ts
# 格式：(行号, 'before'/'after'/'after_block', '中文批注')
# 行号一律指 source/ 原文；批注正文不写反斜杠。
ANNOTATIONS = [
    (5, 'after',
     "注意：这里只 import 类型，真正的 @aws-sdk/client-bedrock-runtime 在文件末尾的 countTokensWithBedrock() 里才动态 import()（第 477 行）——目的是把约 279KB 的 AWS SDK 推迟到真正走 Bedrock 计数时才加载，不拖慢 CLI 启动。"),

    (33, 'after',
     "计数场景的两个魔法数字：thinking budget 给 1024、max_tokens 给 2048。API 硬约束是 max_tokens 必须大于 thinking.budget_tokens，否则直接报错；这两个值刚好满足约束，又足以覆盖 thinking 内容本身。"),

    (38, 'after',
     "hasThinkingBlocks：纯遍历——只要 messages 里出现 assistant 的 thinking 或 redacted_thinking 块就返回 true。它的唯一用途是告诉后面的 countTokens 请求「要不要带上 thinking 参数」。"),

    (56, 'after',
     "这段 strip 只为兼容 tool search beta：tool_use 块上的 caller 字段、tool_result 里的 tool_reference 块，离开该 beta 头就是非法字段，会让计数请求 400。把它们剔掉后再发，拿不到（运行时可能存在）就用 as unknown as 强转绕开 SDK 类型。"),

    (66, 'after',
     "stripToolSearchFieldsFromMessages：把每条 message 的 tool search 专用字段清掉。tool_use 只保留 type/id/name/input；tool_result 里若全是 tool_reference 则替换成占位文本 [tool references]，避免空 content 触发 API 报错。"),

    (124, 'after',
     "countTokensWithAPI：给「一段纯文本」数 token 的便捷入口。空字符串直接返回 0——API 不接受空 message，特判掉以免白跑一次网络调用。"),

    (143, 'after',
     "countMessagesTokensWithAPI：核心的「精确计数」入口，被所有需要真实 token 数的地方调用。整段包在 withTokenCountVCR 里——VCR 是录制/回放层，测试和生产都复用同一套计数逻辑。"),

    (150, 'after',
     "走 Bedrock 时直接调 countTokensWithBedrock()：Bedrock 的 SDK 不支持 Anthropic 那套 beta.messages.countTokens，必须改用 invokeModel + CountTokensCommand 的另一套流程（见文件末尾）。"),

    (170, 'after',
     "Vertex 对 beta 头极其敏感：web-search 等某些 beta 在部分 Vertex 端点会直接 400。上面把不在 VERTEX_COUNT_TOKENS_ALLOWED_BETAS 白名单里的 beta 过滤掉再发请求（issue #10789）。"),

    (189, 'after',
     "防御式兜底：若拿不到数字类型的 input_tokens（Vertex 会抛异常、Bedrock 会返回带 UnknownOperationException 的奇怪结构），直接返回 null，让上层退化到 rough 估算——计数失败绝不导致主流程崩。"),

    (203, 'after',
     "roughTokenCountEstimation：最廉价的离线估算，按「字符数 / bytesPerToken」四舍五入。默认 ratio 4（约 4 字节一个 token），是没其他信息时的保底估计。"),

    (215, 'after',
     "bytesPerTokenForFileType：按文件类型给更准的 ratio。稠密 JSON 大量单字符 token（{}:,\"），真实 ratio 接近 2 而非默认 4——漏估会让超大工具结果悄悄混进上下文。"),

    (234, 'after',
     "roughTokenCountEstimationForFileType：在知道文件类型时用更准的 ratio 的版本。当 API 精确计数不可用（如 Bedrock）退回 rough 估算时，这个区分尤其重要。"),

    (251, 'after',
     "countTokensViaHaikuFallback：用 Haiku 替你数 token 的兜底路径。返回 input + cache_creation + cache_read 三类 token 之和，覆盖「已被压缩过的 message」比 getTokenUsage 更可靠。"),

    (277, 'after',
     "模型选择三元：Vertex 全球区 / Bedrock 带 thinking / Vertex 带 thinking 这三种情况退化到 Sonnet（Haiku 在那些环境不支持或不可用）；其余一律 Haiku（getSmallFastModel 尊重用户的 ANTHROPIC_SMALL_FAST_MODEL 覆盖，见 issue #10883）。"),

    (302, 'after',
     "这里故意用 beta.messages.create 而不是 countTokens：因为要数 thinking 块与 cache 相关 token，且 sideQuery 不支持 thinking/betas 这类专用参数（见上方 biome-ignore 注释）。"),

    (327, 'after',
     "roughTokenCountEstimationForMessages / ForMessage：把一批（可能是 assistant/user/attachment 混合的）message 各自估算后求和。attachment 会先 normalizeAttachmentForAPI 拆成 user message 再数。"),

    (341, 'after',
     "roughTokenCountEstimationForMessage：单条 message 的估算分发。assistant/user 取 message.content，attachment 走 normalize 后的 user message，其余类型（系统事件等）直接 0。"),

    (371, 'after',
     "roughTokenCountEstimationForContent：内容级分发——字符串直接估，块数组逐块估。是 rough 估算处理结构化 content 的总入口。"),

    (391, 'after',
     "roughTokenCountEstimationForBlock：逐块类型给估算。text 按字符数；image/document 统一估成 2000（见下）；tool_result 递归 content；tool_use 按 name+JSON(input)；thinking 按 thinking 文本；其余 server_tool 类按 jsonStringify 长度。"),

    (411, 'after',
     "图片/文档块统一估成 2000 token：这是保守值，与 microCompact 的 IMAGE_MAX_TOKEN_SIZE 对齐——宁可高估（早点触发压缩）也不要低估（太晚触发、上下文直接爆掉）。文档块绝不能落到 jsonStringify 兜底，否则 1MB PDF 的 base64 会被估成 ~32 万 token。"),

    (422, 'after',
     "tool_use 块按 name + JSON(input) 的字符数估：input 是模型生成的 JSON（bash 命令、Edit diff、整文件内容），可以任意大；API 会重新序列化，所以字符数就是它实际看到的量。"),

    (437, 'after',
     "countTokensWithBedrock：Bedrock 专用计数。要点是 CountTokens 只认基础 model ID，不认 inference profile/ARN——所以先用 isFoundationModel / getInferenceProfileBackingModel 把底层模型 ID 解析出来。"),

    (479, 'after',
     "真正的动态 import()：只有走到这条 Bedrock 分支才会把 @aws-sdk/client-bedrock-runtime 拉进运行时——与文件顶部「延迟加载 279KB」的设计首尾呼应。"),
]
