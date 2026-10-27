ANNOTATIONS = [
    (33, 'after', '''从插件目录与清单加载智能体定义，解析 frontmatter 元数据并注入系统提示与工具集。'''),
    (63, 'after', '''loadAgentsFromDirectory：遍历插件 markdown 目录，逐个加载智能体并跳过重复路径。'''),
    (168, 'after', '''插件智能体故意不解析 permissionMode/hooks/mcpServers：第三方代码不应越过用户安装时授予的信任边界，需在 .claude/agents 显式声明才生效。'''),
    (229, 'after', '''loadAgentFromFile：读文件、解析 frontmatter（名称/描述/工具/记忆范围/隔离/effort/最大轮次等），合成系统提示与加载工具集，失败时返回 null。'''),
    (344, 'after', '''loadPluginAgents：记忆化地并行加载所有启用插件的智能体，按插件隔离已加载路径以避免重复。'''),
    (348, 'after', '''clearPluginAgentCache：清空记忆化缓存，便于测试或重新加载。'''),
]
