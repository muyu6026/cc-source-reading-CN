# -*- coding: utf-8 -*-
# slug: src_utils_peerAddress_ts  | source: src/utils/peerAddress.ts
ANNOTATIONS = [
    (1, 'before', '''本文件负责解析「对等节点地址」，刻意从 peerRegistry 拆出，使 SendMessageTool 在枚举工具时无需连带加载 bridge（axios）与 UDS（fs、net）等重模块。'''),
    (7, 'after', '''parseAddress 把一个 URI 风格地址拆成 scheme 与目标两段；支持 uds、bridge、other 三种 scheme。'''),
    (21, 'after', '''解析规则：以 uds: 或 / 开头走 Unix 域套接字分支；以 bridge: 开头走桥接分支；其余一律归为 other。对旧代码裸套接字路径的兼容也并入 uds 分支，避免回复被错误丢进队友路由。'''),
]
