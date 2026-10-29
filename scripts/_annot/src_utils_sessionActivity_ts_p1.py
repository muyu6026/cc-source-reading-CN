# 数据文件：src/utils/sessionActivity.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/sessionActivity.ts'

ANNOTATIONS = [
    (16, 'after', '导入清理注册、无隐私诊断日志与环境变量判断工具。'),
    (18, 'after', '心跳间隔固定 30 秒。'),
    (28, 'after', '模块级状态：回调、引用计数、各原因的计数表、计时器与启动时间等。'),
    (40, 'after', 'startHeartbeatTimer：每 30 秒触发一次回调（仅在开启发送开关时真正发送），用于保持容器存活。'),
    (58, 'after', 'clearIdleTimer：安全清除空闲计时器。'),
    (66, 'after', 'registerSessionActivityCallback：注册保活回调，若已有工作进行中则顺带重启心跳。'),
    (76, 'after', 'unregisterSessionActivityCallback：注销回调并停止计时器。'),
    (86, 'after', 'isSessionActivityTrackingActive：仅当回调已注册才算激活。'),
    (115, 'after', 'startSessionActivity：引用计数加一；从 0 变 1 时启动心跳，并在首次调用时注册一个关闭时的诊断日志。'),
    (133, 'after', 'stopSessionActivity：计数减一；归零时停心跳并启动空闲计时器，30 秒无活动后记录一次 idle 日志。'),
]
