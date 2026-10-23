ANNOTATIONS = [
    (15, 'before', '''inputSchema 只有一个可选 server 过滤参数——不传就是全服务器罗列。'''),
    (40, 'before', '''ListMcpResourcesTool：罗列已连 MCP 服务器的资源。资源（resources）与工具（tools）是 MCP 的两套能力面，这个工具只扫前者。'''),
    (46, 'after', '''isConcurrencySafe + isReadOnly 双真：纯读、可并行——多个资源列举可以同时跑，不互相挡。'''),
    (66, 'before', '''call() 从 options.mcpClients 拿连接池。'''),
    (69, 'before', '''指定了 server 就按名字过滤；过滤完是空的直接抛错并附上可用服务器名单——模型写错服务器名时一次就能自纠。'''),
    (83, 'after', '''这段注释是三层缓存/重连策略的说明：fetchResourcesForClient 按服务器名 LRU 缓存且启动预热；onclose 和 resources/list_changed 通知会失效缓存，所以结果不会过期；ensureConnectedClient 健康时是 memoize 命中（零成本），掉线后返回新连接让重捞成功。'''),
    (84, 'before', '''Promise.all 并行捞所有服务器，但**单个服务器重连失败不许拖垮整体**——try/catch 里 logMCPError 记一笔后返回空数组，其余服务器的结果照常返回。多服务器场景的默认姿态：部分失败降级为部分结果。'''),
    (105, 'before', '''isResultTruncated：序列化后按行数判截断（isOutputLineTruncated），与 tool_result 的呈现口径一致。'''),
    (108, 'before', '''空结果不返回空 content——换成一句人话「没有资源，但服务器可能仍有工具」：防止模型把「零资源」解读成「服务器没用」而错失工具面。'''),
]
