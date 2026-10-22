# -*- coding: utf-8 -*-
# MCPTool/classifyForCollapse.ts 批注数据
ANNOTATIONS = [
    (11, 'after', '''这个文件是纯数据加一个归一化函数：为约 30 个常见 MCP 服务器手工维护「搜索类」「读取类」工具名单，供 UI 折叠判断。设计取向刻意保守——名字不认识的工具一律不折叠，宁可多显示也不误折叠有副作用的调用。'''),
    (139, 'after', '''SEARCH_TOOLS 覆盖 Slack/GitHub/Datadog/Sentry/Notion/Gmail/Drive/Jira/Asana/PubMed/Exa/Perplexity 等约 30 家服务器的搜索动词。注意 search_docs（Sentry 与 Supabase）和 find_projects（Sentry 与 Todoist）各自出现两次——Set 天然去重，这正是「按工具名匹配、不区分服务器」策略的好处与代价：写名单的人不用管服务器叫什么，但跨服务器的同名工具也无法区分。'''),
    (586, 'after', '''READ_TOOLS 是 SEARCH_TOOLS 的三倍以上，全是 get_/list_/read_ 前缀的读取动作。k8s 的 kubectl_get/describe/logs 算读所以折叠，但 kubectl_apply/delete 不在名单里——有副作用的绝不折叠。Git 和 PagerDuty 在注释里说明「没有搜索动词/全靠 get_list_」——没有条目也是一种有意识的记录。'''),
    (593, 'after', '''normalize 只做两件事：camelCase 插下划线、kebab 换 snake、统一小写。Notion 的 search、MongoDB 的 find 这类极短名字也直接命中——短名字的跨服务器歧义风险由「不认识就不折叠」兜底。'''),
    (598, 'after', '''参数名 _serverName 带下划线是故意弃用：托管服务器的名字会被加前缀（slack 与 claude_ai_Slack 是同一个），不稳定；工具名才是跨安装稳定的键。所以匹配只看 toolName，第一个参数收下但不用。'''),
    (604, 'after', '''返回的 isSearch 与 isRead 相互独立：一个工具可以只搜不读、只读不搜，或两者都不是（两个 false，不折叠）。UI 拿这个二元组决定把调用显示成一行还是完整展开。'''),
]
