ANNOTATIONS = [
    (1, 'after', """本模块从各 --add-dir 附加目录读取插件相关设置（enabledPlugins 与 extraKnownMarketplaces）。这些来源的优先级最低——调用方必须把标准设置 spread 在它之上，让用户、项目、本地、命令行旗标与策略来源全部压过它。"""),
    (22, 'after', """需要扫描的两个设置文件名。在每个目录内部，settings.local.json 在 settings.json 之后处理，因此本地版本在目录内优先。"""),
    (34, 'before', """合并所有 --add-dir 目录里的 enabledPlugins。目录内部 local 覆盖普通；目录之间靠后处理的 CLI 顺序在冲突时胜出。整体优先级最低，必须由调用方在其上 spread 标准设置来让其他来源覆盖。"""),
    (48, 'after', """第一个合并函数收尾：返回累积到的 enabledPlugins 记录。任何目录缺失该字段都直接跳过，不报错。"""),
    (56, 'before', """第二个合并函数，规则与上一个完全相同，只是合并的对象换成 extraKnownMarketplaces（额外已知市场列表）。"""),
    (71, 'after', """整模块收尾：两个只读合并函数，所有附加目录的来源都不可覆盖标准设置，确保 --add-dir 项的优先级恒为最低。"""),
]
