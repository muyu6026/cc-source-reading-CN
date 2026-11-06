# 批注数据：source/src/cli/transports/transportUtils.ts
# slug: src_cli_transports_transportUtils_ts

ANNOTATIONS = [
    (1, 'after', '引入 URL、环境变量布尔判定与各传输实现类。'),
    (8, 'after', '注释：根据 URL 与开关选择适当传输层的辅助函数，并给出传输选择优先级（SSE > Hybrid > WebSocket）。'),
    (16, 'after', '导出 getTransportForUrl：按协议与环境变量挑选传输实现。'),
    (22, 'after', 'v2 开关（CLAUDE_CODE_USE_CCR_V2）：启用时走 SSE 读 + HTTP POST 写。'),
    (24, 'after', '注释：--sdk-url 是会话 URL，需追加 /worker/events/stream 派生 SSE 流地址。'),
    (26, 'after', '克隆 URL 以便改写协议与路径。'),
    (27, 'after', 'ws/wss 协议需降级为 https/http 以走 SSE。'),
    (33, 'after', '改写路径名、追加 SSE 流端点。'),
    (34, 'after', '返回 SSE 传输实例。'),
    (37, 'after', '默认分支：处理 ws/wss 协议。'),
    (38, 'after', '第二开关（CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2）：启用时走 WS 读 + POST 写。'),
    (41, 'after', '默认 WebSocket 传输：WS 读 + WS 写。'),
    (43, 'after', '其余协议不支持，抛出错误。'),
]
