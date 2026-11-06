# -*- coding: utf-8 -*-
# 第 167 批：src/assistant/sessionHistory.ts 批注数据
ANNOTATIONS = [
    (1, 'after', '''依赖：axios、OAuth 配置、SDK 消息类型、调试日志、teleport API 鉴权与请求准备。'''),
    (7, 'after', '''HISTORY_PAGE_SIZE：每页拉一百条事件，分页游标固定步长。'''),
    (16, 'after', '''HistoryPage 类型：本页事件数组、最旧 id（作 before 游标）、是否还有更旧。'''),
    (23, 'after', '''SessionEventsResponse：远端原始响应形状，snake_case 字段。'''),
    (28, 'after', '''HistoryAuthCtx：把鉴权与 base URL 备好，跨页复用避免重复准备。'''),
    (43, 'after', '''createHistoryAuthCtx：一次性拼好鉴权头与事件接口地址，含 beta 标头与组织 uuid。'''),
    (49, 'after', '''fetchPage：内部通用拉页函数，带超时与全状态放行（validateStatus 恒真）。'''),
    (67, 'after', '''fetchPage 收尾：把响应规整成 HistoryPage，坏响应或丢事件都兜底成空数组。'''),
    (78, 'after', '''fetchLatestEvents：取最新一页（anchor_to_latest），has_more 表示有更旧。'''),
    (87, 'after', '''fetchOlderEvents：取 beforeId 之前的一页，往前翻历史。'''),
]
