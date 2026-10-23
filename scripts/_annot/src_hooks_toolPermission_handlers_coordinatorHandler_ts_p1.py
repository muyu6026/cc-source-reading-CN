ANNOTATIONS = [
    (26, 'before', r'''handleCoordinatorPermission：coordinator worker 的权限流。与 swarm worker 的差别：自动化检查（钩子 + 分类器）顺序 await 完再落交互对话框——coordinator 的对话框不是主 agent 那种四方竞速，而是「自动的都试过了，剩下的问你」。'''),
    (31, 'before', r'''try 块：两个自动化检查都可能抛。'''),
    (33, 'before', r'''① 钩子先行。'''),
    (38, 'after', r'''顺序有意：钩子快且纯本地，分类器慢且要推理。先跑便宜的——大多数 hook 配置（如 dangerouslyDisableSandbox 审计）能在毫秒级给出答案。'''),
    (41, 'before', r'''② 分类器后行（仅 bash + feature 开）。'''),
    (46, 'after', r'''任一检查给出决策就返回，不再往下。'''),
    (47, 'before', r'''catch：自动化检查意外抛错时不崩溃——落对话框让人工决定。'''),
    (57, 'after', r'''非 Error throw 手动包前缀（Automated permission check failed: ...）——注释明说故意不用 toError()，那会丢掉前缀让日志不可追查。可追溯性优先于类型纯净。'''),
    (59, 'before', r'''③ 都没解决（或检查失败）——返回 null 回退对话框。'''),
    (62, 'after', r'''隐式契约：返回 null 时钩子已经跑过一遍了，所以 interactiveHandler 那边的 awaitAutomatedChecksBeforeDialog 参数此时为真，跳过重复执行。两个 handler 靠这个布尔参数协作，改任一侧都要记得另一边。'''),
]
