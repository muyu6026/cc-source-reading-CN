# -*- coding: utf-8 -*-
"""bridge/replBridgeTransport.ts 批注数据（replBridge 的 v1/v2 传输适配）。"""

ANNOTATIONS = [
    (1, 'before', 'replBridge 的传输抽象层：把 v1（HybridTransport）与 v2（SSE 读 + CCR 写）两套实现收敛成同一个接口，让握手处的 v1/v2 选择局限在构造点'),
    (23, 'before', 'ReplBridgeTransport：replBridge 需要的完整传输表面，含写入、状态、序号高水位、状态上报与投递确认'),
    (78, 'before', 'createV1ReplTransport：v1 适配器，HybridTransport 已具备全部方法，这里只是透传；v1 不报序号、不设置丢批计数'),
    (119, 'before', 'createV2ReplTransport：v2 适配器，组合 SSETransport（读）与 CCRClient（写、心跳、状态、投递），注册动作放在这里以便整个握手是一步异步'),
    (157, 'before', '解出公共入参'),
    (169, 'before', '鉴权头构造：传了 getAuthToken 就按实例读取（多会话安全），否则把 ingress 令牌写进进程级环境变量（单会话老路径）'),
    (183, 'before', 'epoch 优先用调用方给的（/bridge 响应已是注册），否则在此处注册工作进程'),
    (190, 'before', '从 http(s) 基址推导 SSE 流 URL，复用 transportUtils 的改写逻辑'),
    (193, 'before', '建 SSE 读流与 CCR 写客户端，两者共享认证头'),
    (202, 'before', 'CCRClient 构造时已把 SSE 事件接到 reportDelivery(收到)，这里再补上处理态，解决守护进程路径下事件永远停在收到态、重启被重排成幽灵提示的问题'),
    (249, 'before', '覆盖构造时的事件接线：收到即同时 ACK 收到与已处理（SSE 接收与落盘之间窗口很窄，崩溃最多丢一条，远好于每重启重排一堆）'),
    (266, 'before', '声明连接 / 初始化 / 关闭三类状态变量，它们都在 connect 之前就需要被回调引用'),
    (270, 'before', '返回的对象实现整套传输接口：写走 CCRClient、状态读 ready 标志、序号取 SSE 高水位、各类上报透传'),
    (284, 'before', 'close：置关闭标志后关 CCR 与 SSE，避免在拆传输后还发半截批次'),
    (304, 'before', 'setOnClose：把 SSE 的重连预算耗尽映射成 4092，关闭 CCR 心跳后再通知 replBridge'),
    (316, 'before', 'setOnConnect：只是记下回调，真正触发在 CCR 初始化成功之后'),
    (336, 'before', 'connect：按需开 SSE 读流（outboundOnly 时跳过），再初始化 CCR 并触发 onConnect；初始化失败则关资源并以 4091 通知重连'),
]
