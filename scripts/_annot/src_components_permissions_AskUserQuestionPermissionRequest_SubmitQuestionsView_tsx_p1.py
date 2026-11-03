# 数据文件：src/components/permissions/AskUserQuestionPermissionRequest/SubmitQuestionsView.tsx
# slug = src_components_permissions_AskUserQuestionPermissionRequest_SubmitQuestionsView_tsx
ANNOTATIONS = [
    (21, 'before', '''提交前确认视图：汇总所有已答问题、展示当前答案、给出规则说明，最后让用户提交或取消'''),
    (34, 'after', '''顶部一条分隔线（inactive 配色），把「审阅答案」区和上方导航隔开'''),
    (51, 'after', '''标题「Review your answers」，用普通文本色'''),
    (58, 'after', '''尚未答完全部问题时给出黄色警告，提示用户先补齐'''),
    (66, 'after', '''把每个已答问题渲染成「问题 + 绿色箭头 + 答案」两行缩进结构'''),
    (78, 'after', '''展示本次权限决策的规则依据（tool 类型），让用户知道为何这样判定'''),
    (97, 'after', '''「Submit answers」是普通文本选项，值为 submit'''),
    (108, 'after', '''选项数组：提交 + 取消两项，cancel 用 text 类型'''),
    (115, 'after', '''渲染选项框：选择提交或取消都走同一回调，由回传值区分；取消键等价于 cancel'''),
    (135, 'after', '''外层用带顶边线的盒子包住导航条、标题、答案区与提交区，形成统一的审阅卡片'''),
]
