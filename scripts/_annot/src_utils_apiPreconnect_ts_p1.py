# -*- coding: utf-8 -*-
"""src/utils/apiPreconnect.ts 的中文批注数据。"""

ANNOTATIONS = [
    (1, 'after', '''在启动时预先连接 Anthropic API，把 TCP 加 TLS 握手与初始化工作并行，缩短首个请求的真实延迟；Bun 会复用全局保活连接池。'''),
    (29, 'after', '''`fired` 是一次性旗标，保证预热只触发一次，避免重复发起无意义的连接。'''),
    (31, 'before', '''`preconnectAnthropicApi` 在诸多跳过条件下直接返回：已触发、使用云厂商后端、或配了代理与双向认证等自定义传输。'''),
    (60, 'after', '''基址优先用环境变量 `ANTHROPIC_BASE_URL`，否则回落到 OAuth 配置里的 API 基址，一次查找覆盖预发、本地与自定义网关。'''),
    (71, 'after', '''用 HEAD 请求发起即弃：无响应体、握手一完成即可入池复用；十秒超时防止弱网拖垮进程，超时也无妨，真实请求会重新握手。'''),
]
