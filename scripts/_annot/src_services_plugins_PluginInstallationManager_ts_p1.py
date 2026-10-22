# 批注数据：source/src/services/plugins/PluginInstallationManager.ts
# 格式：(行号, 'before'/'after'/'after_block', '中文批注')
# 行号一律指 source/ 原文；批注正文不写反斜杠。
ANNOTATIONS = [
    (35, 'after',
     "updateMarketplaceStatus：把某个市场的安装状态写进 AppState。用函数式更新（prevState => ...）保证并发 setState 不互相覆盖——React/ink 的 AppState 更新范式。"),

    (62, 'after',
     "performBackgroundPluginInstallations：启动时的后台安装入口。职责是「从受信来源（仓库设置 + 用户设置）自动装声明了的市场和插件，且不阻塞启动」。它是 reconcileMarketplaces 的薄包装，真正干活的是 reconciler；这里只负责把 onProgress 事件映射成 REPL UI 能看的状态。"),

    (74, 'after',
     "pendingNames = 缺失的市场 + 源变了的市场。diff 是「声明 vs 已物化」的比对：missing 是声明了但没装的，sourceChanged 是装过但源地址变了的（要重装）。先算 diff 是为了让 UI 一开始就能显示 pending 转圈，而不是等 reconcile 跑起来才有反馈。"),

    (93, 'after',
     "没有 pending 就直接返回——不需要 reconcile，也不需要碰 AppState。注意上面已经用 pendingNames（空数组）初始化过 UI 状态了，所以这里返回时 UI 显示的是「无待装项」而非残留的旧状态。"),

    (120, 'after',
     "reconcileMarketplaces 的 onProgress 回调：installing / installed / failed 三类事件分别推进 AppState，让 REPL 实时显示每个市场的安装进度。失败也写进状态（带 error），用户在 UI 里能看到哪个市场挂了、为什么。"),

    (135, 'after',
     "有新市场装成功 → 自动刷新插件。这修的是「plugin-not-found」错误：全新 homespace 或缓存被清时，首次加载只有缓存、市场还没 clone 完，插件自然找不到。刷新会清所有缓存、重载插件、bump pluginReconnectKey 让 MCP 连接重建。"),

    (166, 'after',
     "只有更新（没有新装）→ 不自动刷新，只置 needsRefresh 提示用户手动跑 /reload-plugins。更新没那么急，且该由用户决定什么时候应用——避免用户正干着活时被重载打断。"),
]
