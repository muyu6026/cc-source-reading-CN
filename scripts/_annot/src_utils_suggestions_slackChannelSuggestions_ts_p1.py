# source: src/utils/suggestions/slackChannelSuggestions.ts
ANNOTATIONS = [
    (9, 'after', '''Slack 搜索频道用的 MCP 工具名固定为 slack_search_channels。'''),
    (13, 'after', '''用普通 Map 而非 LRUCache：前缀匹配需要遍历全部条目，LRU 不提供干净接口。'''),
    (18, 'after', '''knownChannels 收集所有曾由 MCP 返回过的真实频道名，只让确认存在的频道在输入框里变蓝。'''),
    (23, 'after', '''findSlackClient：从已连接 MCP 里挑名字含 slack 的那个客户端。'''),
    (32, 'after', '''fetchChannels：调 Slack MCP 搜索频道，把 markdown 结果解析成频道名数组（失败返回空）。'''),
    (69, 'after', '''resultsEnvelopeSchema：Slack MCP 把结果包成 {results:...} 的 JSON 信封，这里声明其结构。'''),
    (73, 'after', '''unwrapResults：若文本以 { 开头就按信封解析取 results，否则原样返回。'''),
    (87, 'after', '''parseChannels：用正则从 Name: #chan 行里抽取频道名，去重后收集。'''),
    (112, 'after', '''findSlackChannelPositions：在文本里找出所有已知频道的起止下标（用于高亮）。'''),
    (129, 'after', '''mcpQueryFor：Slack 按连字符分词且要整词匹配，故截掉末尾残段只发完整词，本地再过滤（既保精确又避 20 条上限）。'''),
    (143, 'after', '''findReusableCacheEntry：找 key 是本次查询前缀且仍含匹配项的缓存，让 c→cl→cla 复用同一份结果，少打 MCP。'''),
    (162, 'after', '''getSlackChannelSuggestions：合并缓存、在途请求与新拉取，返回按前缀过滤、排序、截断到前 10 的频道建议。'''),
    (203, 'after', '''clearSlackChannelCache：清空全部缓存与已知频道集合（版本归零、在途请求清空）。'''),
]
