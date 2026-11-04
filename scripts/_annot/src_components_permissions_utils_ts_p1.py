# 权限事件埋点的统一出口
ANNOTATIONS = [
    (5, 'before', '权限事件埋点统一走这里：接受、拒绝、带反馈三种调用点共用同一份 metadata 形状，避免口径分裂'),
    (8, 'after', '从确认对象里解构出 message_id：埋点靠它把事件挂回具体的那次工具调用'),
    (15, 'after', '用 void 显式丢弃 Promise：埋点上报失败绝不该影响权限流程本身'),
    (22, 'after', 'hasFeedback 缺省补齐为 false：undefined 直接进 metadata 会让下游统计出现第三种状态'),
]
