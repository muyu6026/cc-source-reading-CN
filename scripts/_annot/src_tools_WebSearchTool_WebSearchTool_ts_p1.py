# -*- coding: utf-8 -*-
"""WebSearchTool/WebSearchTool.ts 第 1 部分"""

ANNOTATIONS = [
    (37, 'after', '''输入：query（≥2 字符）+ 可选的 allowed_domains / blocked_domains
（二者互斥，validateInput 强制）。'''),
    (54, 'after', '''单次搜索结果：tool_use_id + 命中列表（title + url）。'''),
    (66, 'after', '''输出 results 是混合数组：SearchResult 对象（每次搜索一组）与
字符串（模型评论）交错，一一对应服务端返回的块序列。'''),
    (72, 'after', '''WebSearchProgress 从集中类型文件 re-export：打破 import 环
（UI 与工具互相引用类型时的常规解法）。'''),
    (84, 'after', '''把用户输入映射成服务端 web_search_20250305 工具 schema：
域过滤直接透传，max_uses 硬编码 8——一次 WebSearch 调用内最多自动搜 8 次。'''),
    (99, 'after', '''结果解析状态机：服务端返回块序列为 [text] (server_tool_use +
web_search_tool_result + text/引用)*——每个 server_tool_use 是一次搜索。
textAcc 累积文本，遇到 server_tool_use 就把累积文本落一条字符串。'''),
    (129, 'after', '''web_search_tool_result 的 content 不是数组 = 服务端报错
（WebSearchToolResultError）：记日志并把错误文案当字符串结果插入，不中断。'''),
    (139, 'after', '''text 块：inText 为 true 是搜索前后的评论，直接追加；
false 说明刚结束一轮搜索结果，重新开一段。'''),
    (150, 'after', '''收尾：残余 textAcc 再落一条。'''),
    (193, 'after', '''isEnabled 按提供商分档：firstParty 恒开；vertex 仅 Claude 4.0+ 系列
（模型名包含 claude-{opus,sonnet,haiku}-4）；foundry 只发已支持搜索的模型，恒开；
其余（Bedrock 旧模型等）关。'''),
    (222, 'after', '''checkPermissions 走 passthrough——不自带判定，交给通用权限层；
建议里附「把 WebSearch 加进 localSettings 放行」的一键规则。'''),
    (234, 'after', '''extractSearchText 返回空串：结果 UI 只显示「Did N searches in Xs」一行 chrome，
results 内容从不上屏——若让全文搜索启发式去索引字符串项只会得到幻影命中。
这是「UI 展示什么决定搜索层索引什么」的注释标本。'''),
    (253, 'after', '''validateInput：query 非空（错误码 1）；
allowed_domains 与 blocked_domains 不得同时给（错误码 2）——服务端二选一。'''),
    (259, 'after', '''call 全流程：包一句用户消息「Perform a web search for the query: X」
→ queryModelWithStreaming 带上 web_search 服务端工具 schema → 逐事件消费流
→ makeOutputFromSearchResponse 归整。'''),
    (265, 'after', '''tengu_plum_vx3 特性开关：开则用 Haiku 跑搜索代理
（关 thinking、强制 tool_choice=web_search），关则沿用主循环模型与 thinking 配置。'''),
    (291, 'after', '''工具 schema 经 extraToolSchemas 注入（不进本进程的工具注册表，
是发给 API 的服务端工具）；tools: [] 保证本地工具不掺和。'''),
    (297, 'after', '''流消费状态：currentToolUseId 跟踪正在到来的 server_tool_use 块，
toolUseQueries 记 tool_use_id → 实际查询词的映射。'''),
    (316, 'after', '''server_tool_use 块开始时拿不到 input.query——查询词是后续
input_json_delta 增量拼出来的，所以这里只记 id 清空缓冲。'''),
    (330, 'after', '''边收边猜：用正则从部分 JSON 里抠出已完整的 "query" 字段，
解析成功且与上次不同就发 query_update 进度——用户能在结果回来前看到实际搜索词。'''),
    (357, 'after', '''部分 JSON 解析失败静默忽略——流还在继续，下一轮 delta 再试。'''),
    (388, 'after', '''web_search_tool_result 块开始 = 一轮搜索命中：发 search_results_received
进度（结果数 + 该轮真实查询词，找不到映射才退回原始 query）。'''),
    (392, 'after', '''计时用 performance.now（毫秒精度），输出按秒计。'''),
    (424, 'after', '''结果回传给模型的格式化：字符串项原样拼；SearchResult 项拼 Links: <JSON>。
(results ?? []) 与 null 检查防压缩/反序列化往返产生的空项。'''),
    (427, 'after', '''尾部加 REMINDER：必须在给用户的回复里用 markdown 超链接引用来源——
与 prompt.ts 的 Sources 硬性要求双保险。'''),
    (435, 'after', '''第三个泛型参数 WebSearchProgress：让 onProgress 的 data 类型
（query_update / search_results_received）被类型系统追踪到 UI 层。'''),
]
