# source: src/utils/plugins/refresh.ts
ANNOTATIONS = [
    (38, 'after', '''三层模型：L1 意图（settings）、L2 物化（~/.claude/plugins/）、L3 本文件负责把激活组件换进运行中的 AppState。'''),
    (58, 'after', '''刷新结果结构：各计数 + 刷新后的 agent/mcp 定义，供调用方同步 AppState 之外的本地可变引用。'''),
    (74, 'after', '''refreshActivePlugins：清全部插件缓存 → 完整加载 → 填充 mcp/lsp → 更新 AppState → 触发 LSP 重初始化与 hook 全量交换。'''),
    (75, 'after', '''先清所有插件缓存（旧 needsRefresh 路径只清 loadAllPlugins，会返回下游记忆化的陈旧数据）。'''),
    (88, 'after', '''先 await 完整 loadAllPlugins 预热缓存；它完成后再读的 cacheOnly 记忆化近乎免费，避免竞态导致插件缓存未命中。'''),
    (123, 'after', '''一次性更新 AppState：enabled/disabled/commands/errors，并把 mcp.pluginReconnectKey 自增以触发 MCP 重连 effect。'''),
    (145, 'after', '''无条件重初始化 LSP 管理器（无 LSP 时 no-op），确保新增或移除的 LSP 插件配置都被正确拾取（修 issue #15521）。'''),
    (152, 'after', '''hook 全量交换（含新启用插件的 hook）；失败只计 error_count，不丢上面的插件/命令/agent 数据（hook 进 STATE 不进 AppState）。'''),
    (163, 'after', '''汇总所有启用插件的 hook 总数（按各 hooksConfig 匹配器里的 hook 长度累加）。'''),
    (202, 'after', '''mergePluginErrors：把本系统记录的 lsp-manager 与 plugin:* 错误与本次新鲜错误合并去重，避免刷新丢错误。'''),
    (211, 'after', '''errorKey：用 type/source/error 生成去重键，generic-error 额外带上 error 文本。'''),
]
