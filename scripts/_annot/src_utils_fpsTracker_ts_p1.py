ANNOTATIONS = [
    (1, 'before', '''文件级：一个轻量 FPS 度量类型与采集器，记录每帧时长并算出平均 FPS 与低 1% 帧率。'''),
    (4, 'after', '''FpsMetrics 类型：只有 averageFps（平均帧率）与 low1PctFps（最慢 1% 帧对应的帧率）两个字段。'''),
    (6, 'before', '''FpsTracker 类：用 frameDurations 存每帧时长，firstRenderTime / lastRenderTime 标记首末帧时刻。'''),
    (18, 'after', '''record 收尾：每帧把耗时压入数组并刷新 lastRenderTime（首帧额外记 firstRenderTime）。'''),
    (46, 'after', '''getMetrics 收尾：算出平均 FPS，并把帧时长排序取 p99 帧时反推低 1% 帧率，结果四舍五入保留两位小数。'''),
]
