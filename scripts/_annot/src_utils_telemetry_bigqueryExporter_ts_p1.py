# OpenTelemetry 指标导出器：把内部指标转成 BigQuery 上传格式，发到 Anthropic 指标接口
ANNOTATIONS = [
    (40, 'before', '''BigQuery 指标导出器类，实现 OpenTelemetry 的 PushMetricExporter 接口'''),
    (46, 'before', '''构造时选定上报端点（内部用户可走环境变量覆盖）和超时，默认 5 秒'''),
    (63, 'before', '''导出入口：记录待发请求，完成后从队列移除；已关闭则直接失败'''),
    (87, 'before', '''真正的导出逻辑：先校验信任态与组织开关，再转换、鉴权、POST 上报'''),
    (150, 'before', '''把 OTel 指标转成内部 payload：固定资源属性 + 每个指标的数据点'''),
    (198, 'before', '''抽取数据点：只保留数值型，属性转成字符串，时间戳转成 ISO 格式'''),
    (215, 'before', '''关闭导出器：先强制把待发请求刷完再标记关闭'''),
    (221, 'before', '''强制刷新：等所有待发导出 Promise 完成'''),
    (226, 'before', '''把属性对象里非空的值统一转成字符串'''),
    (240, 'before', '''把 OpenTelemetry 的 [秒, 纳秒] 时间转成 ISO 字符串'''),
    (246, 'before', '''聚合时态固定用 DELTA（增量），改 CUMULATIVE 会搞乱生产力看板'''),
]
