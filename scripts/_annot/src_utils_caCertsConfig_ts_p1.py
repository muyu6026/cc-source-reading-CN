# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'after', '''从 caCerts.ts 拆出来的模块，理由写在头部：config.ts 的依赖图拖着约 5300 个模块（React、全部斜杠命令），代理与 mTLS 那条线绝不能沾，否则 Agent SDK 包体从 0.4MB 涨到 10.8MB。'''),
    (18, 'after', '''本模块是全仓唯一允许 import config.ts 去填充 NODE_EXTRA_CA_CERTS 的地方：caCerts.ts 本身只读环境变量，收口在一个文件里，依赖图的边界才守得住。'''),
    (36, 'after', '''环境里已有值就直接退出：用户自己 shell 里设的优先级永远最高，配置只是兜底。'''),
    (40, 'after', '''写到 process.env 而不是传参：下游的 caCerts.ts 只认环境变量，这里早启动时先垫上。'''),
    (45, 'after', '''必须在任何 TLS 连接建立之前执行：Bun 用 BoringSSL 在启动期缓存证书库，晚了自定义 CA 就进不去了。'''),
    (66, 'after', '''只读用户级设置：项目级 settings.json 不在允许范围内——恶意项目不能在信任对话弹出之前就往进程里塞 CA 证书。'''),
    (75, 'after', '''优先级与全局环境变量应用逻辑一致：settings 的 env 覆盖全局配置的 env，避免同一变量两处来源各说各话。'''),
    (88, 'after', '''整个读取包在 try 里：config 加载失败只降级为「没有自定义 CA」，CLI 其余功能照常——证书是增强项，不是启动前提。'''),
]
