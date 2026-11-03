# 数据文件：src/components/permissions/useShellPermissionFeedback.ts
# slug = src_components_permissions_useShellPermissionFeedback_ts
ANNOTATIONS = [
    (16, 'before', '''Shell 类权限弹窗（Bash / PowerShell）共用的反馈态 hook：封装「是/否」输入模式切换、反馈文本、焦点与拒绝处理'''),
    (40, 'after', '''从全局应用状态取出 setter，用于记录权限请求的逃逸次数（归因统计）'''),
    (48, 'after', '''六个状态：两种反馈文本、两种输入模式、当前聚焦项，以及「是否曾进入反馈模式」的持久标记'''),
    (51, 'before', '''Tab 键切换「是/否」选项的输入模式：进入模式时上报 entered、收起时上报 collapsed，并记录「曾进入」标记'''),
    (82, 'before', '''拒绝处理：有反馈文本则作为拒绝理由回传，无则直接拒绝；无论哪种都收尾 onReject/onDone'''),
    (88, 'after', '''无反馈直接退出（Esc）时上报 escape 事件，并累加归因计数器的 escapeCount'''),
    (92, 'after', '''用函数式更新累加逃逸计数，避免并发状态下读到旧值'''),
    (118, 'before', '''焦点切换：仅在焦点真正变化时通知交互，并在离开「是/否」选项且无文本时收起其输入模式'''),
    (125, 'after', '''切换到别的选项且原输入模式无文本时，自动收起该模式，保持界面干净'''),
]
