# source: src/utils/mcpValidation.ts
ANNOTATIONS = [
    (14, 'after', '''触发真实 token 计数的阈值系数：估算不超过上限的 50% 就假定无需截断，省去 API 调用。'''),
    (15, 'after', '''单张图片按 1600 token 估算（不实际计费，仅用于预算）。'''),
    (26, 'after', '''getMaxMcpOutputTokens：优先级 env 变量 > tengu_satin_quoll 的 mcp_tool 键 > 硬编码默认 25000。'''),
    (49, 'after', '''MCPToolResult：工具结果可以是纯字符串、内容块数组或 undefined。'''),
    (59, 'after', '''getContentSizeEstimate：字符串按粗略 token 估算，内容块逐个累加（图片按 1600 计）。'''),
    (77, 'after', '''getMaxMcpOutputChars：token 上限乘 4 换算成字符预算（MCP 自有截断层，按字符计）。'''),
    (81, 'after', '''getTruncationMessage：超量时附带的输出已截断提示，引导用户用分页或过滤工具取具体数据。'''),
    (87, 'after', '''truncateString：未超预算原样返回，否则按 maxChars 切片。'''),
    (97, 'after', '''truncateContentBlocks：按字符预算贪心保留文本块；图片超预算时尝试压缩以塞进剩余空间，压缩失败就跳过。'''),
    (153, 'after', '''mcpContentNeedsTruncation：先用大小估算做启发式，确需再调 token 计数 API；出错则假定不截断。'''),
    (182, 'after', '''truncateMcpContent：字符串切片后补截断提示；内容块则截断后在末尾追加一条提示块。'''),
    (202, 'after', '''truncateMcpContentIfNeeded：仅在判定需要截断时才真正截断（门控函数）。'''),
]
