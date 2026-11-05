# -*- coding: utf-8 -*-
"""remote/SessionsWebSocket.ts 批注数据（CCR 会话 WebSocket 客户端）。"""

ANNOTATIONS = [
    (1, 'before', '连接 CCR 会话的 WebSocket 客户端：读消息流、按 4001 等关闭码决定重连还是放弃，并把控制请求 / 响应发回去'),
    (17, 'before', '三个重连与心跳常量：基础重连延迟、最大尝试次数、ping 间隔'),
    (34, 'before', '永久拒绝的关闭码集合：目前只有 4003（未授权），命中即停止重连，由调用方处理永久关闭'),
    (46, 'before', '消息类型守卫：只要带字符串 type 字段就收下，下游再决定怎么处理——用开放式判断而非白名单，避免后端新增类型时客户端直接丢消息'),
    (57, 'before', '回调集合：消息、关闭、错误、连接成功，以及「检测到瞬时断开并安排了重连」这一额外回调'),
    (68, 'before', '为同时兼容浏览器原生 WebSocket 与 Node 的 ws 库，抽象出只够用的方法集合'),
    (82, 'before', 'SessionsWebSocket 类：持有连接状态、重连计数、ping 定时器'),
    (100, 'before', 'connect：按运行环境分两条路建连——Bun 用原生 WebSocket，Node 用 ws 库，两者事件名不同但要做同样的事'),
    (120, 'before', 'Bun 分支：原生 WebSocket 支持代理与 TLS 选项，事件用 addEventListener 绑定'),
    (164, 'before', 'Node 分支：用 ws 库，事件用 on 绑定；这里不用 addEventListener 写法'),
    (210, 'before', 'handleMessage：解析后若类型守卫通过就转给回调，否则只记日志忽略，不抛错'),
    (234, 'before', 'handleClose：先停 ping，再根据关闭码决定——永久码直接关、4001 有限重试、曾连接才重连，否则放弃'),
    (258, 'before', '4001（会话找不到）在压缩期间可能是瞬时的：给一个小重试预算，耗尽才放弃重连'),
    (290, 'before', 'scheduleReconnect：通知调用方即将重连，并延时后重新 connect'),
    (301, 'before', 'startPingInterval：定时 ping 保活，写失败就忽略，交给关闭处理去兜底'),
    (318, 'before', 'stopPingInterval：清空并置空 ping 定时器'),
 (328, 'before', 'sendControlResponse：仅已连接时才能发，把控制响应序列化后送出'),
    (341, 'before', 'sendControlRequest：发出控制请求（如中断），自动补上 request_id'),
    (362, 'before', 'isConnected：只看状态是否为 connected'),
    (369, 'before', 'close：停 ping、清重连定时器、关底层连接并置空，断开时要先摘事件处理器避免竞态'),
    (393, 'before', 'reconnect：强制重连——重置计数、关旧连接、延时后重连，常用于订阅失效后的自救'),
]
