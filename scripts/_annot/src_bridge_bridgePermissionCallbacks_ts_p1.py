# 数据文件：source/src/bridge/bridgePermissionCallbacks.ts
ANNOTATIONS = [
    (1, 'after', """桥接权限回调的类型契约：请求侧 sendRequest/sendResponse/cancelRequest/onResponse，以及校验解析结果的类型守卫 isBridgePermissionResponse。"""),
    (3, 'after', """响应结构：behavior 是 allow 或 deny 判别字段，可附带更新后的输入/权限与提示文案。"""),
    (10, 'after', """回调接口：发请求、发响应、取消待处理请求（让网页端关掉弹窗）、订阅响应（返回取消订阅函数）。"""),
    (20, 'after', """发响应：把权限判定结果回传给请求方。"""),
    (22, 'after', """取消请求，让 Web 端关闭其提示弹窗。"""),
    (26, 'after', """订阅某请求的响应，返回的箭头函数是取消订阅器。"""),
    (32, 'before', """类型守卫：判断未知值是否为合法的 BridgePermissionResponse，只看 behavior 是否为 allow 或 deny，比直接 as 断言更安全。"""),
    (35, 'after', """守卫只看 behavior 是否为 allow 或 deny，拒绝非对象与缺字段的情况。"""),
    (42, 'after', """导出类型和守卫供桥接层使用。"""),
]
