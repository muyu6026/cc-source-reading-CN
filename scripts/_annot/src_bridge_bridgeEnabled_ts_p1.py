# -*- coding: utf-8 -*-
# 批注数据：src/bridge/bridgeEnabled.ts
# 锚点 (行号, pos, 中文)。pos ∈ before/after/after_block。
ANNOTATIONS = [
    (1, 'after', '模块：桥接（远程控制）模式的资格运行时检查。远程控制要求 claude.ai 订阅并持有 OAuth 令牌。'),
    (28, 'before', '`isBridgeEnabled`：运行时资格判断。采用正向三元模式，确保构建期能剔除内联字符串字面量。'),
    (32, 'after', '`feature(`BRIDGE_MODE`)` 守卫：仅当构建期启用桥接模式，才引用 GrowthBook 字符串字面量，外部构建不会泄露。'),
    (50, 'before', '`isBridgeEnabledBlocking`：阻塞式资格检查，对过期的 false 会等待 GrowthBook 初始化并取最新值。'),
    (70, 'before', '`getBridgeDisabledReason`：返回不可用的具体诊断消息，给用户的错误要可操作（提示重登）。'),
    (94, 'before', '三个内部包装函数：在配置尚未加载时 swallow 异常，返回安全的默认值（此时不可能有 OAuth 令牌）。'),
    (126, 'before', '`isEnvLessBridgeEnabled`：v2 无环境变量桥接路径开关，只控制用哪套实现，不决定桥接是否可用。'),
    (141, 'before', '`isCseShimEnabled`：`cse_*` 到 `session_*` 的客户端重打标签开关；后端改用 environment_kind 且前端接受 `cse_*` 后可关闭。'),
    (160, 'before', '`checkBridgeMinVersion`：env 版（v1）远程控制的最低版本检查；v2 走另一套独立版本下限。'),
    (185, 'before', '`getCcrAutoConnectDefault`：用户未显式设置时，启动自动连接 CCR 的默认值（仅 ant 的自动连接构建标志开启时生效）。'),
    (197, 'before', '`isCcrMirrorEnabled`：可选开启的 CCR 镜像模式，每个本地会话额外发起只出站、接收转发事件的桥接会话。'),
]
