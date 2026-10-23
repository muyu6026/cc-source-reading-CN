ANNOTATIONS = [
    (25, 'after', r'''【插件加载三层模型】挂载时做初始 Layer-3 加载：loadAllPlugins → delisting 强制 → flagged 通知 → 填 AppState.plugins。之后的刷新一律走 /reload-plugins，这个 hook 不自动刷新——注释解释了原因：历史上的自动刷新有 stale-cache bug（只清了 loadAllPlugins，下游 memoized loader 返回旧数据）且不完整（不含 MCP、agentDefinitions）。一个命令一个心智模型。'''),
    (47, 'after_block', r'''初始加载与会话刷新的差异：初始加载跑 delisting 强制和 flagged 通知（session-start 关切），且不 bump mcp.pluginReconnectKey（MCP effect 自己挂载时触发）；刷新路径 refreshActivePlugins 全换（commands/agents/hooks/MCP 一处不漏）。'''),
    (60, 'after', r'''flagged 插件通知。key 固定 'plugin-delisted-flagged'——同一个 key 的通知是替换而不是堆叠，重复挂载不会弹出一串。'''),
    (119, 'after', r'''MCP 计数必须在 setAppState 之前算。LoadedPlugin.mcpServers 这个字段 loadAllPlugins 不填——它是给 extractMcpServersFromPlugins 后填的缓存槽，与这里的指标计算存在竞态。直接调 loadPluginMcpServers 既拿得到正确计数，又顺带预热了 MCP 连接管理器的缓存。且这些 loader 推的 errors 要在 setAppState 前进数组，才能进 AppState.plugins.errors 被 Doctor UI 看见，而不只是遥测。'''),
    (130, 'after', r'''LSP reinit 是防御性的：#15521 的真正修复在 refresh.ts（performBackgroundPluginInstallations → refreshActivePlugins 先清缓存）。这里再 init 一次，是因为 main.tsx:3203 到 REPL 挂载之间可能发生缓存失效（marketplace 种子注册、policySettings 热重载）。'''),
    (168, 'after', r'''errors 合并而非覆盖：prevState 里 LSP 相关的错误（source 'lsp-manager' 或 'plugin:*'）要保留——它们不是本次加载产生的。新 errors 里已有的按 type+source 去重键剔除旧条目，防 Doctor UI 里同一条错误出现两次。'''),
    (213, 'after', r'''ant 构建专属指标：启用了哪些插件，与 RSS/FPS 关联分析。刻意与基础指标分开——它不该流进 logForDiagnosticsNoPII（no-PII 日志），且类型名 AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS 本身就是「人工验过这不再是代码或路径」的标记类型。'''),
    (229, 'after', r'''catch 兜底：只有插件系统级失败（loadAllPlugins 本身炸）才到这里。置空 enabled/disabled/commands，但保留 LSP 错误 + 追加 plugin-system 错误——用户看到「插件加载失败」但 LSP 诊断不丢。返回全 0 指标带 load_failed: true。'''),
    (293, 'after', r'''needsRefresh（磁盘上插件变了：后台 reconcile、/plugin 菜单、外部改 settings）只弹通知指向 /reload-plugins。不自动刷新、不重置 needsRefresh——后者由 /reload-plugins 经 refreshActivePlugins 消费。两个 effect 的分工是：这个 hook 负责「启动时加载 + 提示变更」，命令负责「应用变更」。'''),
]
