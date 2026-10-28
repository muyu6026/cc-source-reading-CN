# -*- coding: utf-8 -*-
# 批注：src/utils/errors.ts
ANNOTATIONS = [
    (3, 'before', '普通错误基类，构造时把 name 设为类名便于识别'),
    (12, 'before', '中止错误，固定 name 为 AbortError 以便跨构建识别'),
    (27, 'before', '统一判定任意中止型错误：自研类、DOMException、或 SDK 的 APIUserAbortError（用 instanceof 而非名字，避免压缩后类名被混淆）'),
    (39, 'before', '配置解析错误，额外携带出错路径与应使用的默认配置'),
    (93, 'before', '用极长的类名刻意提醒：调用前必须确认消息里没有路径或代码这类敏感数据；单参时日志与遥测同消息，双参分开'),
    (111, 'before', '把任意值规整成 Error 实例，用于 catch 边界'),
    (119, 'before', '从未知错误值里取出字符串消息，用于日志或展示'),
    (128, 'before', '取出错误的 errno 码（如 ENOENT/EACCES），取代直接强转的写法'),
    (161, 'before', '截取错误前 N 个堆栈帧，喂给模型时省 token，完整堆栈留给调试日志'),
    (186, 'before', '判断路径是否「缺失/无权限/结构不可达」，用于 fs 操作后的 catch 区分预期与意外'),
    (197, 'before', '把 axios 错误归类的枚举：auth/timeout/network/http/other'),
    (213, 'before', '把一次 axios 请求捕获的错误分桶（401/403→auth、ECONNABORTED→timeout 等），取代各处重复的判错链'),
]
