# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (42, 'after', '''logPermissionEvent 统一记录 accept/reject 一元事件，附带语言名、消息 id、平台与是否有反馈。'''),
    (54, 'after', '''PermissionHandlerOptions 携带反馈文本、是否进入反馈模式、以及授权作用域（claude 目录 / 全局目录）。'''),
    (85, 'after', '''handleAcceptOnce 处理『本次允许』：记录接受事件并带上反馈，调用 onAllow 放行单次。'''),
    (139, 'after', '''handleAcceptSession 处理『会话内允许』：
若作用于 claude 目录则追加对应目录权限规则到会话；否则按路径生成建议规则交给 onAllow。'''),
    (176, 'after', '''handleReject 记录拒绝事件并关闭，把反馈（如有）传给 onReject。'''),
    (185, 'after', '''PERMISSION_HANDLERS 把选项类型（accept-once / accept-session / reject）映射到对应处理函数。'''),
]
