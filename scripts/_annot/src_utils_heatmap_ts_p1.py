ANNOTATIONS = [
    (8, 'after', '''HeatmapOptions 控制终端热力图的宽度与是否显示月份标签。'''),
    (14, 'after', '''Percentiles 预先计算 p25、p50、p75 三个分位数，用于把消息数映射为强度等级。'''),
    (19, 'before', '''calculatePercentiles 从每日活动数据中滤出正计数并排序，算出三个分位数供强度查询复用。'''),
    (34, 'after', '''calculatePercentiles 收尾：无数据时返回 null。'''),
    (39, 'before', '''generateHeatmap 生成 GitHub 风格的终端活动热力图，按周列与工作日行排布，最多展示一年。'''),
    (166, 'after', '''generateHeatmap 收尾：拼装月份标签、星期标签、网格与图例后返回完整字符串。'''),
    (168, 'before', '''getIntensity 按消息数相对分位数的位置返回 0 到 4 的强度等级。'''),
    (178, 'after', '''getIntensity 收尾：低于 p25 记 1 级，零数据或无分位数记 0 级。'''),
    (181, 'after', '''claudeOrange 是 Claude 主题橙色的 chalk 颜色实例，用于渲染不同强度方块。'''),
    (183, 'before', '''getHeatmapChar 根据强度等级返回对应密度的方块字符，零级用灰色点。'''),
    (198, 'after', '''getHeatmapChar 收尾：强度 1 到 4 分别用由疏到密的橙色方块。'''),
]
